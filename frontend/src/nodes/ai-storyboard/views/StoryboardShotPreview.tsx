import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileNodeData } from '@/types';
import { useImageResource } from '@/hooks/image/useImageResource';
import { useProtectedResourceUrl } from '@/hooks/file/useProtectedResourceUrl';
import { getFileNodeImageThumbnailUrl } from '@/services/image/image-asset';
import { httpClient } from '@/api';

interface StoryboardShotPreviewProps {
  src?: string;
  fallbackSrc?: string;
  sourceNode?: FileNodeData;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  mediaType?: 'image' | 'video';
}

function isVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')
    || lower.includes('.mp4?') || lower.includes('.webm?') || lower.includes('.mov?');
}

const EMPTY_IMAGE_NODE: Pick<FileNodeData, 'id' | 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'> = {
  id: { value: '', display: '' },
  fileId: '',
  imageAsset: undefined,
  thumbnailUrl: undefined,
  metadata: {},
};

export const StoryboardShotPreview: React.FC<StoryboardShotPreviewProps> = ({
  src,
  fallbackSrc,
  sourceNode,
  alt,
  className,
  fallback = null,
  mediaType,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);
  const [hasAttemptedFallback, setHasAttemptedFallback] = useState(false);

  // Reset fallback state when src changes
  useEffect(() => {
    setActiveSrc(src);
    setHasAttemptedFallback(false);
  }, [src]);

  const imageResource = useImageResource(sourceNode ?? EMPTY_IMAGE_NODE, 'canvas', {
    enabled: Boolean(sourceNode && sourceNode.type === 'image' && !activeSrc),
  });
  const sourceThumbnailUrl = sourceNode && sourceNode.type === 'image'
    ? getFileNodeImageThumbnailUrl(sourceNode)
    : undefined;
  const protectedResourceUrl = activeSrc ?? imageResource.requestUrl ?? sourceThumbnailUrl;
  const isVideo = useMemo(
    () => mediaType === 'video' || (mediaType !== 'image' && isVideoUrl(protectedResourceUrl)),
    [mediaType, protectedResourceUrl],
  );

  // For video files, use token-based URL directly instead of blob fetch
  // (video element can't set Authorization headers, and blob fetch is slow for large files)
  const videoDirectUrl = useMemo(() => {
    if (!isVideo || !protectedResourceUrl) return undefined;
    const token = httpClient.getAuthToken();
    if (!token) return protectedResourceUrl;
    const separator = protectedResourceUrl.includes('?') ? '&' : '?';
    return `${protectedResourceUrl}${separator}token=${encodeURIComponent(token)}`;
  }, [isVideo, protectedResourceUrl]);

  // Only use protected resource hook for non-video files
  const protectedResource = useProtectedResourceUrl(
    isVideo ? undefined : protectedResourceUrl,
    { enabled: Boolean(protectedResourceUrl) && !isVideo },
  );

  // Auto-fallback: when the primary URL fails and fallbackSrc is available, retry with fallback
  useEffect(() => {
    if (
      !protectedResource.error
      || hasAttemptedFallback
      || !fallbackSrc
      || fallbackSrc === activeSrc
    ) {
      return;
    }

    setHasAttemptedFallback(true);
    setActiveSrc(fallbackSrc);
  }, [activeSrc, fallbackSrc, hasAttemptedFallback, protectedResource.error]);

  const resolvedSrc = isVideo
    ? videoDirectUrl
    : activeSrc
      ? protectedResource.resolvedUrl
      : (imageResource.src ?? protectedResource.resolvedUrl);

  const openViewer = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (resolvedSrc) {
      setViewerOpen(true);
    }
  }, [resolvedSrc]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
  }, []);

  useEffect(() => {
    if (!viewerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeViewer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeViewer, viewerOpen]);

  if (!resolvedSrc) {
    if (activeSrc && protectedResource.error && hasAttemptedFallback) {
      return (
        <div className="ai-storyboard-shot-preview__fallback ai-storyboard-shot-preview__error">
          图片加载失败
        </div>
      );
    }
    return <>{fallback}</>;
  }

  return (
    <>
      <button
        type="button"
        className="ai-storyboard-shot-preview__button nodrag nopan"
        onClick={openViewer}
        title="查看完整预览"
      >
        {isVideo ? (
          <video
            src={resolvedSrc}
            className={className}
            muted
            loop
            autoPlay
            playsInline
            draggable={false}
          />
        ) : (
          <img
            src={resolvedSrc}
            alt={alt}
            className={className}
            draggable={false}
          />
        )}
      </button>

      {viewerOpen && typeof document !== 'undefined' ? createPortal(
        <div className="file-node__viewer-backdrop ai-storyboard-shot-viewer-backdrop" onClick={closeViewer}>
          <div className="file-node__viewer ai-storyboard-shot-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="file-node__viewer-toolbar">
              <div className="file-node__viewer-toolbar-main">
                <div className="file-node__viewer-title-block">
                  <span className="file-node__viewer-title">{alt}</span>
                  <span className="file-node__viewer-meta">{isVideo ? '视频预览' : '完整预览'}</span>
                </div>
              </div>

              <div className="file-node__viewer-toolbar-extra">
                <span className="file-node__viewer-tool-slot">Storyboard preview</span>
              </div>

              <button type="button" className="file-node__viewer-close" onClick={closeViewer} title="关闭预览">
                {'x'}
              </button>
            </div>

            <div className="file-node__viewer-stage ai-storyboard-shot-viewer__stage">
              {isVideo ? (
                <video
                  src={resolvedSrc}
                  className="file-node__viewer-image ai-storyboard-shot-viewer__image"
                  controls
                  autoPlay
                  muted
                  loop
                  draggable={false}
                />
              ) : (
                <img
                  src={resolvedSrc}
                  alt={alt}
                  className="file-node__viewer-image ai-storyboard-shot-viewer__image"
                  draggable={false}
                />
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
};

StoryboardShotPreview.displayName = 'StoryboardShotPreview';
