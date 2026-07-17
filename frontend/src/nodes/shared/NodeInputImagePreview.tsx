import React from 'react';
import type { FileNodeData } from '@/types';
import { useImageResource } from '@/hooks/image/useImageResource';
import { useProtectedResourceUrl } from '@/hooks/file/useProtectedResourceUrl';

export interface NodeInputImagePreviewProps {
  sourceNode?: FileNodeData;
  src?: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  draggable?: boolean;
}

const EMPTY_IMAGE_NODE: Pick<FileNodeData, 'id' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'> = {
  id: { value: '', display: '' },
  fileId: '',
  imageAsset: undefined,
  thumbnailUrl: undefined,
  metadata: {},
};

export const nodeInputImagePreviewRuntime = {
  useImageResource,
  useProtectedResourceUrl,
};

export const NodeInputImagePreview: React.FC<NodeInputImagePreviewProps> = ({
  sourceNode,
  src,
  alt,
  className,
  fallback = null,
  draggable = false,
}) => {
  const imageResource = nodeInputImagePreviewRuntime.useImageResource(
    sourceNode?.type === 'image' ? sourceNode : EMPTY_IMAGE_NODE,
    'canvas',
    {
      enabled: Boolean(sourceNode && sourceNode.type === 'image'),
    },
  );
  const protectedResource = nodeInputImagePreviewRuntime.useProtectedResourceUrl(src, {
    enabled: Boolean(src),
  });

  const resolvedSrc = imageResource.src
    ?? protectedResource.resolvedUrl;

  if (!resolvedSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      draggable={draggable}
    />
  );
};

NodeInputImagePreview.displayName = 'NodeInputImagePreview';
