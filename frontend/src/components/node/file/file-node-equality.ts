import type { NodeProps } from 'reactflow';
import type { FileNodeData, FileSource, ImageAsset } from '@/types';

type FileNodeProps = NodeProps<FileNodeData>;

function hasSameDimensions(previous: FileNodeData, next: FileNodeData): boolean {
  return previous.dimensions.width === next.dimensions.width &&
    previous.dimensions.height === next.dimensions.height;
}

function hasSameMetadata(previous: FileNodeData, next: FileNodeData): boolean {
  return previous.metadata.width === next.metadata.width &&
    previous.metadata.height === next.metadata.height &&
    previous.metadata.duration === next.metadata.duration;
}

function hasSameSource(previous: FileSource, next: FileSource): boolean {
  return previous.type === next.type &&
    previous.importMethod === next.importMethod &&
    previous.sourceDisplayName === next.sourceDisplayName &&
    previous.localSource?.status === next.localSource?.status &&
    previous.localSource?.referenceId === next.localSource?.referenceId &&
    previous.originalPath === next.originalPath &&
    previous.importedAt === next.importedAt &&
    previous.uploadedBy === next.uploadedBy &&
    previous.producerNodeId === next.producerNodeId &&
    previous.producerNodeDisplayId === next.producerNodeDisplayId &&
    previous.producerNodeType === next.producerNodeType &&
    previous.taskId === next.taskId &&
    previous.taskNo === next.taskNo &&
    previous.taskCreatedAt === next.taskCreatedAt &&
    previous.taskStartedAt === next.taskStartedAt &&
    previous.taskCompletedAt === next.taskCompletedAt;
}

function hasSameImageAsset(previous?: ImageAsset, next?: ImageAsset): boolean {
  return previous?.version === next?.version &&
    previous?.assetId === next?.assetId &&
    previous?.source === next?.source &&
    previous?.intrinsicSize?.width === next?.intrinsicSize?.width &&
    previous?.intrinsicSize?.height === next?.intrinsicSize?.height &&
    previous?.variants.thumbnail?.url === next?.variants.thumbnail?.url;
}

function hasSameSharedRenderFields(previous: FileNodeProps, next: FileNodeProps): boolean {
  return previous.selected === next.selected &&
    Boolean(previous.dragging) === Boolean(next.dragging) &&
    previous.data.id.value === next.data.id.value &&
    previous.data.id.display === next.data.id.display &&
    previous.data.type === next.data.type &&
    previous.data.status === next.data.status &&
    previous.data.fileId === next.data.fileId &&
    previous.data.fileName === next.data.fileName &&
    previous.data.fileSize === next.data.fileSize &&
    previous.data.mimeType === next.data.mimeType &&
    previous.data.annotation === next.data.annotation &&
    previous.data.locked === next.data.locked &&
    previous.data.zIndex === next.data.zIndex &&
    previous.data.rotation === next.data.rotation &&
    previous.data.scale === next.data.scale &&
    hasSameSource(previous.data.source, next.data.source) &&
    hasSameDimensions(previous.data, next.data) &&
    hasSameMetadata(previous.data, next.data);
}

export function areImageNodePropsEqual(previous: FileNodeProps, next: FileNodeProps): boolean {
  return hasSameSharedRenderFields(previous, next) &&
    previous.data.thumbnailUrl === next.data.thumbnailUrl &&
    hasSameImageAsset(previous.data.imageAsset, next.data.imageAsset);
}

export function areImageProxyNodePropsEqual(previous: FileNodeProps, next: FileNodeProps): boolean {
  return hasSameSharedRenderFields(previous, next) &&
    previous.data.renderTier === next.data.renderTier &&
    previous.data.activeState === next.data.activeState &&
    previous.data.imageResourceOwner === next.data.imageResourceOwner;
}

export function areVideoNodePropsEqual(previous: FileNodeProps, next: FileNodeProps): boolean {
  return hasSameSharedRenderFields(previous, next) &&
    previous.data.thumbnailUrl === next.data.thumbnailUrl &&
    previous.data.previewUrl === next.data.previewUrl;
}

export function arePlyNodePropsEqual(previous: FileNodeProps, next: FileNodeProps): boolean {
  return hasSameSharedRenderFields(previous, next) &&
    previous.data.thumbnailUrl === next.data.thumbnailUrl &&
    previous.data.previewUrl === next.data.previewUrl;
}
