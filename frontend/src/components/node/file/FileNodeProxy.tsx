import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { NODE_TYPE_INFO } from '@/constants';
import type { FileNodeData, NodeRenderTier } from '@/types';
import { hasRenderableImagePreview } from '@/services/image';

import { NodeErrorBoundary } from '../../ui/ErrorBoundary';
import { areImageProxyNodePropsEqual } from './file-node-equality';
import { resolveFileNodeProxyStatusLabel } from './file-node-proxy.shared';

type FileNodeProxyRenderTier = NodeRenderTier;

export interface FileNodeProxyProps extends NodeProps<FileNodeData> {
  renderTier: FileNodeProxyRenderTier;
}

interface FileNodeProxySurfaceProps {
  data: FileNodeData;
  nodeIcon: string;
  renderTier: FileNodeProxyRenderTier;
}

export const FileNodeProxySurface = memo<FileNodeProxySurfaceProps>(({
  data,
  nodeIcon,
  renderTier,
}) => {
  const statusLabel = resolveFileNodeProxyStatusLabel(data.status);
  const isImageLoading = data.type === 'image' && (
    data.status === 'pending' ||
    data.status === 'processing' ||
    (data.imageResourceOwner !== 'raster' && !hasRenderableImagePreview(data))
  );
  const shouldExposeRasterLayer =
    data.type === 'image' &&
    data.imageResourceOwner === 'raster' &&
    !statusLabel &&
    !isImageLoading;

  if (renderTier === 'minimal') {
    return (
      <div className="file-node__tier-card file-node__tier-card--minimal" data-file-node-proxy-surface={renderTier}>
        <span className="file-node__tier-icon">{isImageLoading ? '...' : nodeIcon}</span>
        <span className="file-node__tier-badge">{statusLabel ?? data.type.toUpperCase()}</span>
      </div>
    );
  }

  if (renderTier === 'full') {
    if (statusLabel || isImageLoading) {
      const isImporting = data.status === 'pending' || data.status === 'processing';
      return (
        <div className="file-node__tier-card file-node__tier-card--full" data-file-node-proxy-surface={renderTier}>
          <span className="file-node__tier-icon">{isImporting || isImageLoading ? '...' : nodeIcon}</span>
          <span className="file-node__tier-badge">{statusLabel ?? 'LOADING'}</span>
        </div>
      );
    }

    return (
      <div
        className="file-node__image-shell file-node__image-shell--raster"
        data-file-node-proxy-surface={renderTier}
        aria-label={data.fileName}
      />
    );
  }

  if (renderTier === 'compact' && shouldExposeRasterLayer) {
    return (
      <div
        className="file-node__image-shell file-node__image-shell--raster"
        data-file-node-proxy-surface={renderTier}
        aria-label={data.fileName}
      />
    );
  }

  return (
    <div className="file-node__tier-card file-node__tier-card--compact" data-file-node-proxy-surface={renderTier}>
      <span className="file-node__tier-icon">{isImageLoading ? '...' : nodeIcon}</span>
      <span className="file-node__tier-file-name" title={data.fileName}>{data.fileName}</span>
      {(statusLabel || isImageLoading) && (
        <span className="file-node__tier-badge">{statusLabel ?? 'LOADING'}</span>
      )}
    </div>
  );
});

FileNodeProxySurface.displayName = 'FileNodeProxySurface';

const FileNodeProxyInner: React.FC<FileNodeProxyProps> = ({
  data,
  selected,
  dragging = false,
  renderTier,
}) => {
  const nodeInfo = NODE_TYPE_INFO[data.type];
  const nodeColor = nodeInfo?.color || '#3b82f6';
  const nodeIcon = nodeInfo?.icon || 'FILE';
  const isImportPlaceholder =
    data.status === 'pending' ||
    data.status === 'processing';
  const isImportError = data.status === 'error';
  const wrapperClasses = [
    'node-wrapper',
    'file-node',
    'file-node--proxy',
    selected ? 'selected' : '',
    isImportPlaceholder ? 'file-node--placeholder' : '',
    isImportError ? 'file-node--error' : '',
    data.type === 'image' && data.imageResourceOwner === 'raster' ? 'file-node--raster-managed' : '',
    renderTier === 'full' ? 'file-node--full-proxy' : '',
    renderTier === 'compact' ? 'file-node--compact' : '',
    renderTier === 'minimal' ? 'file-node--minimal' : '',
    dragging ? 'file-node--dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={wrapperClasses}
      style={{
        width: data.dimensions.width,
        height: data.dimensions.height,
        borderColor: nodeColor,
        transform: `rotate(${data.rotation}deg)`,
        transformOrigin: 'center center',
      }}
      data-file-node-proxy="true"
      data-node-passive-surface="true"
      data-render-tier={renderTier}
      data-image-resource-owner={data.type === 'image' ? data.imageResourceOwner : undefined}
    >
      <div className="file-node__surface">
        <div className="file-node__preview-area">
          <FileNodeProxySurface
            data={data}
            nodeIcon={nodeIcon}
            renderTier={renderTier}
          />
        </div>
        <div className="file-node__id-badge">{data.id.display}</div>
      </div>

      <Handle type="target" position={Position.Left} className="react-flow__handle" style={{ background: nodeColor }} />
      <Handle type="source" position={Position.Right} className="react-flow__handle" style={{ background: nodeColor }} />
    </div>
  );
};

FileNodeProxyInner.displayName = 'FileNodeProxyInner';

const FileNodeProxyComponent: React.FC<FileNodeProxyProps> = (props) => (
  <NodeErrorBoundary nodeId={props.data.id.value} nodeType={`${props.data.type}-proxy`}>
    <FileNodeProxyInner {...props} />
  </NodeErrorBoundary>
);

FileNodeProxyComponent.displayName = 'FileNodeProxyComponent';

export const FileNodeProxy = memo(
  FileNodeProxyComponent,
  (previous, next) => areImageProxyNodePropsEqual(previous, next) && previous.renderTier === next.renderTier,
);
FileNodeProxy.displayName = 'FileNodeProxy';
