import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileNodeData } from '@/types';
import { useImageResource } from '@/hooks/image/useImageResource';
import { useProtectedResourceUrl } from '@/hooks/file/useProtectedResourceUrl';
import { getFileNodeImageThumbnailUrl } from '@/services/image/image-asset';

interface StoryboardShotPreviewProps {
  src?: string;
  sourceNode?: FileNodeData;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
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
  sourceNode,
  alt,
  className,
  fallback = null,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const imageResource = useImageResource(sourceNode ?? EMPTY_IMAGE_NODE, 'canvas', {
    enabled: Boolean(sourceNode && sourceNode.type === 'image' && !src),
  });
  const sourceThumbnailUrl = sourceNode && sourceNode.type === 'image'
    ? getFileNodeImageThumbnailUrl(sourceNode)
    : undefined;
  const protectedResourceUrl = src ?? imageResource.requestUrl ?? sourceThumbnailUrl;
  const protectedResource = useProtectedResourceUrl(protectedResourceUrl, {
    enabled: Boolean(protectedResourceUrl),
  });
  const resolvedSrc = src
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
        <img
          src={resolvedSrc}
          alt={alt}
          className={className}
          draggable={false}
        />
      </button>

      {viewerOpen && typeof document !== 'undefined' ? createPortal(
        <div className="file-node__viewer-backdrop ai-storyboard-shot-viewer-backdrop" onClick={closeViewer}>
          <div className="file-node__viewer ai-storyboard-shot-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="file-node__viewer-toolbar">
              <div className="file-node__viewer-toolbar-main">
                <div className="file-node__viewer-title-block">
                  <span className="file-node__viewer-title">{alt}</span>
                  <span className="file-node__viewer-meta">完整预览</span>
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
              <img
                src={resolvedSrc}
                alt={alt}
                className="file-node__viewer-image ai-storyboard-shot-viewer__image"
                draggable={false}
              />
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
};

StoryboardShotPreview.displayName = 'StoryboardShotPreview';
