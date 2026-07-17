import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

import type { FileNodeData, FileNodeImageResourceOwner } from '../../../types';
import type { UseImageResourceResult } from '../../../hooks/image/useImageResource';
import type { NodeRenderTier } from '../../../types';

import {
  resolveImageNodePreviewDisplay,
  resolveImagePlaceholderLabel,
} from './constants';

interface FileNodeCanvasShellProps {
  data: FileNodeData;
  selected: boolean;
  dragging: boolean;
  nodeColor: string;
  nodeIcon: string;
  wrapperRef: React.RefObject<HTMLDivElement>;
  previewVideoRef: React.RefObject<HTMLVideoElement>;
  imageResource: UseImageResourceResult;
  imageSrc?: string;
  previewVideoSrc?: string;
  imageThumbnailUrl?: string;
  bottomInfoText: string;
  isInteractionActive: boolean;
  isImportPlaceholder: boolean;
  isImportError: boolean;
  imagePreviewDisplay: ReturnType<typeof resolveImageNodePreviewDisplay>;
  hasRenderablePreview: boolean;
  isCanvasImageReady: boolean;
  videoReady: boolean;
  isPreviewPlaying: boolean;
  renderTier: NodeRenderTier;
  imageResourceOwner?: FileNodeImageResourceOwner;
  suppressImageDomPreview?: boolean;
  onImageDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onVideoDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onImageLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onImageError: () => void;
  onVideoLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onVideoLoadedData: () => void;
  onVideoError: () => void;
  onVideoPause: () => void;
  onVideoPlay: () => void;
  onPreviewPlay: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPreviewPause: (event: React.MouseEvent<HTMLButtonElement>) => void;
  canvasRequestDebug?: UseImageResourceResult['debug'];
  viewerRequestKey?: string;
  actionLayer?: React.ReactNode;
}

function renderImagePlaceholder(
  kind: 'default' | 'viewport' | 'loading' | 'unavailable' | 'solid',
  nodeIcon: string
): JSX.Element {
  const classes = ['file-node__placeholder'];

  if (kind === 'solid') classes.push('file-node__placeholder--solid');
  if (kind === 'unavailable') classes.push('file-node__placeholder--error');
  if (kind === 'viewport') classes.push('file-node__placeholder--viewport');
  if (kind === 'loading') classes.push('file-node__placeholder--loading');

  const mappedLabel = resolveImagePlaceholderLabel(
    kind === 'viewport'
      ? 'viewport-hidden'
      : kind === 'solid'
        ? 'default'
      : kind
  );
  const label = mappedLabel === 'default' ? nodeIcon : mappedLabel;

  return <div className={classes.join(' ')}><span className="file-node__placeholder-icon">{label}</span></div>;
}

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export const FileNodeCanvasShell = memo<FileNodeCanvasShellProps>(({
  data,
  selected,
  dragging,
  nodeColor,
  nodeIcon,
  wrapperRef,
  previewVideoRef,
  imageResource,
  imageSrc,
  previewVideoSrc,
  imageThumbnailUrl,
  bottomInfoText,
  isInteractionActive,
  isImportPlaceholder,
  isImportError,
  imagePreviewDisplay,
  hasRenderablePreview,
  isCanvasImageReady,
  videoReady,
  isPreviewPlaying,
  renderTier,
  imageResourceOwner,
  suppressImageDomPreview = false,
  onImageDoubleClick,
  onVideoDoubleClick,
  onImageLoad,
  onImageError,
  onVideoLoadedMetadata,
  onVideoLoadedData,
  onVideoError,
  onVideoPause,
  onVideoPlay,
  onPreviewPlay,
  onPreviewPause,
  canvasRequestDebug,
  viewerRequestKey,
  actionLayer,
}) => {
  const isCompactTier = renderTier === 'compact';
  const isMinimalTier = renderTier === 'minimal';

  const wrapperClasses = ['node-wrapper', 'file-node', selected ? 'selected' : '', data.status === 'processing' && !isImportPlaceholder ? 'processing' : '']
    .concat(isInteractionActive ? 'file-node--active' : '')
    .concat(isImportPlaceholder ? 'file-node--placeholder' : '')
    .concat(isImportError ? 'file-node--error' : '')
    .concat(imagePreviewDisplay === 'viewport-hidden' ? 'file-node--viewport-hidden' : '')
    .concat(isCompactTier ? 'file-node--compact' : '')
    .concat(isMinimalTier ? 'file-node--minimal' : '')
    .concat(suppressImageDomPreview ? 'file-node--raster-managed' : '')
    .concat(dragging ? 'file-node--dragging' : '')
    .filter(Boolean)
    .join(' ');

  const renderTierPreview = (): JSX.Element | null => {
    if (renderTier === 'full') {
      return null;
    }

    if (isImportError) {
      return renderImagePlaceholder('unavailable', nodeIcon);
    }

    if (isImportPlaceholder) {
      return renderImagePlaceholder('loading', nodeIcon);
    }

    if (renderTier === 'minimal') {
      return (
        <div className="file-node__tier-card file-node__tier-card--minimal">
          <span className="file-node__tier-icon">{nodeIcon}</span>
          <span className="file-node__tier-badge">{data.type.toUpperCase()}</span>
        </div>
      );
    }

    return (
      <div className="file-node__tier-card file-node__tier-card--compact">
        <span className="file-node__tier-icon">{nodeIcon}</span>
        <span className="file-node__tier-file-name" title={data.fileName}>{data.fileName}</span>
      </div>
    );
  };

  const renderImagePreview = (): JSX.Element => {
    const tierPreview = renderTierPreview();
    if (tierPreview) {
      return tierPreview;
    }

    if (imagePreviewDisplay === 'viewport-hidden') {
      return renderImagePlaceholder('viewport', nodeIcon);
    }

    if (imagePreviewDisplay === 'loading') {
      return renderImagePlaceholder('loading', nodeIcon);
    }

    if (imagePreviewDisplay === 'unavailable' && !suppressImageDomPreview) {
      return renderImagePlaceholder('unavailable', nodeIcon);
    }

    if (
      imagePreviewDisplay === 'ready' ||
      suppressImageDomPreview
    ) {
      return (
        <div className="file-node__image-shell" onDoubleClick={onImageDoubleClick}>
          {!suppressImageDomPreview && !isCanvasImageReady && renderImagePlaceholder('loading', nodeIcon)}
          {!suppressImageDomPreview && imageSrc && (
            <img
              src={imageSrc}
              alt={data.fileName}
              className={`file-node__media ${isCanvasImageReady ? 'file-node__media--ready' : 'file-node__media--pending'}`}
              onLoad={onImageLoad}
              onError={onImageError}
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
      );
    }

    return renderImagePlaceholder('unavailable', nodeIcon);
  };

  const renderVideoPreview = (): JSX.Element => {
    const tierPreview = renderTierPreview();
    if (tierPreview) {
      return tierPreview;
    }

    if (isImportError) {
      return <div className="file-node__placeholder file-node__placeholder--error"><span className="file-node__placeholder-icon">!</span></div>;
    }

    if (isImportPlaceholder && (data.type !== 'image' || !hasRenderablePreview)) {
      return <div className="file-node__placeholder file-node__placeholder--solid" />;
    }

    if (!previewVideoSrc) {
      return <div className="file-node__placeholder"><span className="file-node__placeholder-icon">{nodeIcon}</span></div>;
    }

    return (
      <div className="file-node__video-shell" onDoubleClick={onVideoDoubleClick}>
        <video
          ref={previewVideoRef}
          src={previewVideoSrc}
          className="file-node__media"
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={onVideoLoadedMetadata}
          onLoadedData={onVideoLoadedData}
          onError={onVideoError}
          onPause={onVideoPause}
          onPlay={onVideoPlay}
        />

        {!isPreviewPlaying && (
          <button className="file-node__video-play-button nodrag nopan" onMouseDown={stopPointerEvent} onClick={onPreviewPlay} title="播放预览" type="button">
            {'▶'}
          </button>
        )}

        {isPreviewPlaying && (
          <button className="file-node__video-pause-button nodrag nopan" onMouseDown={stopPointerEvent} onClick={onPreviewPause} title="暂停预览" type="button">
            {'Ⅱ'}
          </button>
        )}

        {!videoReady && <div className="file-node__video-loading"><span className="file-node__placeholder-icon">{nodeIcon}</span></div>}
      </div>
    );
  };

  const renderPreview = (): JSX.Element => {
    const tierPreview = renderTierPreview();
    if (tierPreview) {
      return tierPreview;
    }

    if (isImportError) {
      return <div className="file-node__placeholder file-node__placeholder--error"><span className="file-node__placeholder-icon">!</span></div>;
    }

    if (data.type !== 'image' && isImportPlaceholder) {
      return <div className="file-node__placeholder file-node__placeholder--solid" />;
    }

    if (data.type === 'video') return renderVideoPreview();
    if (data.type === 'image') return renderImagePreview();
    return <div className="file-node__placeholder"><span className="file-node__placeholder-icon">{nodeIcon}</span></div>;
  };

  return (
    <div
      ref={wrapperRef}
      className={wrapperClasses}
      style={{
        width: data.dimensions.width,
        height: data.dimensions.height,
        borderColor: nodeColor,
        transform: `rotate(${data.rotation}deg)`,
        transformOrigin: 'center center',
      }}
      data-image-request-key={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.requestKey : undefined}
      data-image-request-event={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.lastEventKind : undefined}
      data-image-request-classification={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.lastEventClassification : undefined}
      data-image-request-reason={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.lastEventReason : undefined}
      data-image-switch-reason={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.lastSwitchReason : undefined}
      data-image-attempted-url={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.lastAttemptedUrl : undefined}
      data-image-src={import.meta.env?.DEV && data.type === 'image' ? imageSrc : undefined}
      data-image-status={import.meta.env?.DEV && data.type === 'image' ? imageResource.status : undefined}
      data-image-phase={import.meta.env?.DEV && data.type === 'image' ? imageResource.phase : undefined}
      data-image-visible={import.meta.env?.DEV && data.type === 'image' ? String(imageResource.isVisible) : undefined}
      data-image-near-viewport={import.meta.env?.DEV && data.type === 'image' ? String(imageResource.isNearViewport) : undefined}
      data-image-retry-count={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.retryCount : undefined}
      data-image-cooldown-until={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.cooldownUntil : undefined}
      data-image-retry-trigger={import.meta.env?.DEV && data.type === 'image' ? canvasRequestDebug?.retryTrigger : undefined}
      data-render-tier={renderTier}
      data-image-resource-owner={import.meta.env?.DEV && data.type === 'image' ? imageResourceOwner : undefined}
      data-image-viewer-request-key={import.meta.env?.DEV && data.type === 'image' ? viewerRequestKey : undefined}
      data-image-thumbnail-url={import.meta.env?.DEV && data.type === 'image' ? imageThumbnailUrl : undefined}
    >
      <div className="file-node__surface">
        <div className="file-node__preview-area">{renderPreview()}</div>
        <div className="file-node__top-bar">
          <span className="file-node__file-name" title={data.fileName}>{data.fileName}</span>
        </div>
        <div className="file-node__bottom-bar">
          <span className="file-node__meta-text">{bottomInfoText}</span>
        </div>
        <div className="file-node__id-badge">{data.id.display}</div>
      </div>

      {actionLayer}

      <Handle type="target" position={Position.Left} className="react-flow__handle" style={{ background: nodeColor }} />
      <Handle type="source" position={Position.Right} className="react-flow__handle" style={{ background: nodeColor }} />
    </div>
  );
});

FileNodeCanvasShell.displayName = 'FileNodeCanvasShell';
