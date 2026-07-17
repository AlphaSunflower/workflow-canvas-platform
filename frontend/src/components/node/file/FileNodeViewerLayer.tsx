import React, { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { FileNodeData } from '../../../types';
import { createModuleLogger } from '../../../utils';
import { reportNodeImageLoadFailure } from '../../../services/image';
import { useViewerImageResource } from '../../../hooks/image/useViewerImageResource';
import { Modal } from '../../ui';
import { useNodeRuntimeBindings } from '@/nodes/runtime-bindings';
import {
  IMAGE_VIEWER_DEFAULT_ZOOM,
  IMAGE_VIEWER_MAX_ZOOM,
  IMAGE_VIEWER_MIN_ZOOM,
  IMAGE_VIEWER_WHEEL_STEP,
  IMAGE_VIEWER_ZOOM_STEP,
  resolveImageViewerDisplay,
  resolveImageViewerStatusText,
} from './constants';

const log = createModuleLogger('file-node-viewer');

interface FileNodeViewerLayerProps {
  data: FileNodeData;
  imageViewerOpen: boolean;
  videoModalOpen: boolean;
  previewVideoSrc?: string;
  onCloseImageViewer: () => void;
  onCloseVideoModal: () => void;
  onViewerStatusChange?: (status: string | undefined) => void;
}

function clampImageViewerZoom(value: number): number {
  return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, Number(value.toFixed(2))));
}

export const FileNodeViewerLayer = memo<FileNodeViewerLayerProps>(({
  data,
  imageViewerOpen,
  videoModalOpen,
  previewVideoSrc,
  onCloseImageViewer,
  onCloseVideoModal,
  onViewerStatusChange,
}) => {
  const { workflowId } = useNodeRuntimeBindings();
  const originalImageResource = useViewerImageResource(data, data.type === 'image' && imageViewerOpen, {
    workflowId,
  });
  const originalImageStatus = originalImageResource.status;
  const originalImageRequestUrl = originalImageResource.requestUrl;
  const requestOriginalImage = originalImageResource.request;
  const releaseOriginalImage = originalImageResource.release;
  const [imageViewerZoom, setImageViewerZoom] = useState(IMAGE_VIEWER_DEFAULT_ZOOM);
  const [imageViewerRotation, setImageViewerRotation] = useState(0);

  const originalImageSrc = data.type === 'image' ? originalImageResource.src : undefined;
  const imageViewerDisplay = data.type !== 'image'
    ? 'error'
    : resolveImageViewerDisplay({
      status: originalImageStatus,
      hasImageSrc: Boolean(originalImageSrc),
    });
  const viewerStatusText = data.type !== 'image'
    ? undefined
    : resolveImageViewerStatusText({
      status: originalImageStatus,
    });

  useEffect(() => {
    if (!imageViewerOpen || data.type !== 'image') {
      return;
    }

    setImageViewerZoom(IMAGE_VIEWER_DEFAULT_ZOOM);
    setImageViewerRotation(0);
  }, [data.id.value, data.type, imageViewerOpen]);

  useEffect(() => {
    if (!imageViewerOpen || data.type !== 'image') {
      return;
    }

    void requestOriginalImage();
  }, [data.type, imageViewerOpen, originalImageRequestUrl, requestOriginalImage]);

  useEffect(() => {
    onViewerStatusChange?.(
      data.type === 'image' && imageViewerOpen
        ? originalImageStatus
        : undefined
    );
  }, [data.type, imageViewerOpen, onViewerStatusChange, originalImageStatus]);

  const closeImageViewer = useCallback((): void => {
    onCloseImageViewer();
    setImageViewerZoom(IMAGE_VIEWER_DEFAULT_ZOOM);
    setImageViewerRotation(0);
    releaseOriginalImage();
  }, [onCloseImageViewer, releaseOriginalImage]);

  const zoomImageViewer = useCallback((direction: 'in' | 'out'): void => {
    setImageViewerZoom((current) => {
      const delta = direction === 'in' ? IMAGE_VIEWER_ZOOM_STEP : -IMAGE_VIEWER_ZOOM_STEP;
      return clampImageViewerZoom(current + delta);
    });
  }, []);

  const resetImageViewerTransform = useCallback((): void => {
    setImageViewerZoom(IMAGE_VIEWER_DEFAULT_ZOOM);
    setImageViewerRotation(0);
  }, []);

  const rotateImageViewer = useCallback((direction: 'cw' | 'ccw'): void => {
    setImageViewerRotation((current) => current + (direction === 'cw' ? 90 : -90));
  }, []);

  const handleImageViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    if (!originalImageSrc) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const delta = event.deltaY < 0 ? IMAGE_VIEWER_WHEEL_STEP : -IMAGE_VIEWER_WHEEL_STEP;
    setImageViewerZoom((current) => clampImageViewerZoom(current + delta));
  }, [originalImageSrc]);

  const handleViewerImageError = useCallback(() => {
    originalImageResource.reportRenderableFailure(
      originalImageResource.src,
      `Failed to load viewer image: ${data.fileName}`,
    );
    reportNodeImageLoadFailure(data.id.value, data.fileName, 'original', {
      requestKey: originalImageResource.debug.requestKey,
      attemptedUrl: originalImageResource.src,
    });
    log.warn('handleViewerImageError', `Failed to load viewer image: ${data.fileName}`, {
      nodeId: data.id.value,
      attemptedUrl: originalImageResource.src,
    });
  }, [
    data.fileName,
    data.id.value,
    originalImageResource.debug.requestKey,
    originalImageResource.reportRenderableFailure,
    originalImageResource.src,
  ]);

  return (
    <>
      {data.type === 'video' && previewVideoSrc && (
        <Modal isOpen={videoModalOpen} onClose={onCloseVideoModal} title={data.fileName} size="lg">
          <div className="file-node__modal-player">
            <video src={previewVideoSrc} controls autoPlay className="file-node__modal-video" />
          </div>
        </Modal>
      )}

      {data.type === 'image' && imageViewerOpen && createPortal(
        <div className="file-node__viewer-backdrop" onClick={closeImageViewer}>
          <div className="file-node__viewer" onClick={(event) => event.stopPropagation()}>
            <div className="file-node__viewer-toolbar">
              <div className="file-node__viewer-toolbar-main">
                <div className="file-node__viewer-title-block">
                  <span className="file-node__viewer-title">{data.fileName}</span>
                  <span className="file-node__viewer-meta">
                    {Math.round(imageViewerZoom * 100)}% | {((imageViewerRotation % 360) + 360) % 360}deg
                  </span>
                </div>

                <div className="file-node__viewer-controls">
                  <button type="button" className="file-node__viewer-btn" onClick={() => zoomImageViewer('out')} title="Zoom out">
                    {'-'}
                  </button>
                  <button type="button" className="file-node__viewer-btn" onClick={() => zoomImageViewer('in')} title="Zoom in">
                    {'+'}
                  </button>
                  <button type="button" className="file-node__viewer-btn" onClick={resetImageViewerTransform} title="Reset">
                    {'Reset'}
                  </button>
                  <button type="button" className="file-node__viewer-btn" onClick={() => rotateImageViewer('ccw')} title="Rotate counterclockwise">
                    {'<'}
                  </button>
                  <button type="button" className="file-node__viewer-btn" onClick={() => rotateImageViewer('cw')} title="Rotate clockwise">
                    {'>'}
                  </button>
                </div>
              </div>

              <div className="file-node__viewer-toolbar-extra">
                <span className="file-node__viewer-tool-slot">
                  {viewerStatusText ?? 'Viewer'}
                </span>
              </div>

              <button type="button" className="file-node__viewer-close" onClick={closeImageViewer} title="Close viewer">
                {'x'}
              </button>
            </div>

            <div className="file-node__viewer-stage" onWheel={handleImageViewerWheel}>
              {imageViewerDisplay === 'loading' && (
                <div className="file-node__viewer-placeholder file-node__viewer-placeholder--loading">
                  <div className="file-node__viewer-status-block">
                    <span className="file-node__placeholder-icon">...</span>
                    <span className="file-node__viewer-status-text">{viewerStatusText ?? 'Loading original'}</span>
                  </div>
                </div>
              )}

              {imageViewerDisplay === 'error' && (
                <div className="file-node__viewer-placeholder file-node__viewer-placeholder--error">
                  <div className="file-node__viewer-status-block">
                    <span className="file-node__placeholder-icon">!</span>
                    <span className="file-node__viewer-status-text">
                      {originalImageResource.error ?? 'Original unavailable'}
                    </span>
                  </div>
                </div>
              )}

              {imageViewerDisplay === 'ready' && originalImageSrc && (
                <img
                  src={originalImageSrc}
                  alt={data.fileName}
                  className="file-node__viewer-image"
                  style={{
                    transform: `scale(${imageViewerZoom}) rotate(${imageViewerRotation}deg)`,
                  }}
                  draggable={false}
                  onError={handleViewerImageError}
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

FileNodeViewerLayer.displayName = 'FileNodeViewerLayer';
