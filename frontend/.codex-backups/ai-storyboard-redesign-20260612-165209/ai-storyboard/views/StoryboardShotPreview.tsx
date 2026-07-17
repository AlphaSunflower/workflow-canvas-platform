import React from 'react';
import type { FileNodeData } from '@/types';
import { useImageResource } from '@/hooks/image/useImageResource';
import { useProtectedResourceUrl } from '@/hooks/file/useProtectedResourceUrl';

interface StoryboardShotPreviewProps {
  src?: string;
  sourceNode?: FileNodeData;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

export const StoryboardShotPreview: React.FC<StoryboardShotPreviewProps> = ({
  src,
  sourceNode,
  alt,
  className,
  fallback = null,
}) => {
  const imageResource = useImageResource(sourceNode ?? {
    id: { value: '', display: '' },
    fileId: '',
    imageAsset: undefined,
    thumbnailUrl: undefined,
    metadata: {},
  }, 'canvas', {
    enabled: Boolean(sourceNode && sourceNode.type === 'image' && !src),
  });
  const protectedResource = useProtectedResourceUrl(src, {
    enabled: Boolean(src),
  });
  const resolvedSrc = src
    ? protectedResource.resolvedUrl
    : imageResource.src;

  if (!resolvedSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
};

StoryboardShotPreview.displayName = 'StoryboardShotPreview';
