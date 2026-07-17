/* eslint-disable react-refresh/only-export-components */
import { createElement, memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ComponentType } from 'react';
import type { NodeProps, NodeTypes } from 'reactflow';
import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import { useCanvasImageFirstPainted } from './canvas-image-first-paint-store';
import { useCanvasRasterReadyNodeSrc } from './canvas-raster-ready-store';
import { useCanvasNodeRuntimeBindings } from './node-runtime-bindings';
import {
  FileNodeProxy,
  FileNode,
} from '@/components/node/file';
import {
  useNodeExecutionGroupsRuntime,
} from '@/execution-runtime/useNodeGroupExecutionRuntime';
import { useNodeExecutionRuntime } from '@/execution-runtime/useNodeExecutionRuntime';
import { AIImageGenNode } from '@/nodes/ai-image-gen/component';
import { AIFloorplanColorizeNode } from '@/nodes/ai-floorplan-colorize/component';
import { AIImageHdNode } from '@/nodes/ai-image-hd/component';
import { AIImageInpaintNode } from '@/nodes/ai-image-inpaint';
import { AIImageToPlyNode } from '@/nodes/ai-image-to-ply/component';
import { AIModelRenderTransferNode } from '@/nodes/ai-model-render-transfer/component';
import { AIMultiViewRestoreNode } from '@/nodes/ai-multi-view-restore/component';
import { AIStoryboardNode } from '@/nodes/ai-storyboard/component';
import { AIVideoGenNode } from '@/nodes/ai-video-gen/component';
import { NodeRuntimeBindingsProvider } from '@/nodes/runtime-bindings';

type FileNodeProps = NodeProps<FileNodeData>;
type AINodeProps = NodeProps<AINodeData>;
type DomWindowPlaceholderNodeProps = NodeProps<AnyNodeData>;

export const CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE = '__canvasDomWindowPlaceholder';

function bindFileNodeRenderer(
  Component: ComponentType<FileNodeProps>,
): ComponentType<FileNodeProps> {
  const BoundFileNodeRenderer = memo((props: FileNodeProps) => {
    const bindings = useCanvasNodeRuntimeBindings();
    const value = useMemo(() => ({
      ...bindings,
      nodeExecutionRuntime: null,
      groupExecutionStates: [],
    }), [bindings]);

    return (
      <NodeRuntimeBindingsProvider value={value}>
        <Component {...props} />
      </NodeRuntimeBindingsProvider>
    );
  });

  const componentName = 'displayName' in Component
    ? Component.displayName
    : Component.name;
  BoundFileNodeRenderer.displayName = `Bound${componentName ?? 'FileNodeRenderer'}`;
  return BoundFileNodeRenderer;
}

function bindAINodeRenderer(
  Component: ComponentType<AINodeProps>,
): ComponentType<AINodeProps> {
  const BoundAINodeRenderer = memo((props: AINodeProps) => {
    const bindings = useCanvasNodeRuntimeBindings();
    const nodeId = props.data.id.value;
    const canRun = bindings.selectors.canRunNode(nodeId);
    const nodeExecutionRuntime = useNodeExecutionRuntime(nodeId, {
      workflowId: bindings.workflowId,
      canRun,
    });
    const groupExecutionStates = useNodeExecutionGroupsRuntime(nodeId, bindings.workflowId);
    const value = useMemo(() => ({
      ...bindings,
      nodeExecutionRuntime,
      groupExecutionStates,
    }), [bindings, groupExecutionStates, nodeExecutionRuntime]);

    return (
      <NodeRuntimeBindingsProvider value={value}>
        <Component {...props} />
      </NodeRuntimeBindingsProvider>
    );
  });

  const componentName = 'displayName' in Component
    ? Component.displayName
    : Component.name;
  BoundAINodeRenderer.displayName = `Bound${componentName ?? 'AINodeRenderer'}`;
  return BoundAINodeRenderer;
}

const BoundFileNode = bindFileNodeRenderer(FileNode);
const BoundAIImageGenNode = bindAINodeRenderer(AIImageGenNode);
const BoundAIImageInpaintNode = bindAINodeRenderer(AIImageInpaintNode);
const BoundAIStoryboardNode = bindAINodeRenderer(AIStoryboardNode);
const BoundAIModelRenderTransferNode = bindAINodeRenderer(AIModelRenderTransferNode);
const BoundAIImageToPlyNode = bindAINodeRenderer(AIImageToPlyNode);
const BoundAIMultiViewRestoreNode = bindAINodeRenderer(AIMultiViewRestoreNode);
const BoundAIImageHdNode = bindAINodeRenderer(AIImageHdNode);
const BoundAIFloorplanColorizeNode = bindAINodeRenderer(AIFloorplanColorizeNode);
const BoundAIVideoGenNode = bindAINodeRenderer(AIVideoGenNode);

const DomWindowPlaceholderNode = memo((props: DomWindowPlaceholderNodeProps) => {
  const style = useMemo<CSSProperties>(() => ({
    width: Math.max(1, props.data.dimensions.width),
    height: Math.max(1, props.data.dimensions.height),
    pointerEvents: 'none',
    opacity: 0,
  }), [props.data.dimensions.height, props.data.dimensions.width]);

  return (
    <div
      aria-hidden="true"
      data-canvas-dom-window-placeholder="true"
      data-node-id={props.id}
      style={style}
    />
  );
});

DomWindowPlaceholderNode.displayName = 'DomWindowPlaceholderNode';

const ImageNodeRoute = memo((props: FileNodeProps) => {
  const plannedRenderTier = props.data.renderTier ?? 'full';
  const renderTier = props.data.activeState === 'active'
    ? 'full'
    : plannedRenderTier;
  const requiresRasterReadyProxy = props.data.type === 'image' &&
    props.data.imageResourceOwner === 'raster' &&
    props.data.status !== 'pending' &&
    props.data.status !== 'processing' &&
    props.data.status !== 'error';
  const rasterReadySrc = useCanvasRasterReadyNodeSrc(props.data.id.value);
  const hasRasterFirstPainted = useCanvasImageFirstPainted(props.data.id.value, rasterReadySrc);
  const canUseRasterProxy = !requiresRasterReadyProxy || hasRasterFirstPainted;

  if (
    props.data.type === 'image' &&
    canUseRasterProxy &&
    (renderTier !== 'full' || props.data.imageResourceOwner === 'raster')
  ) {
    return createElement(FileNodeProxy, {
      ...props,
      renderTier,
    });
  }

  const nodeProps = requiresRasterReadyProxy && !hasRasterFirstPainted
    ? ({
      ...props,
      data: {
        ...props.data,
        renderTier: 'full',
        imageResourceOwner: 'dom',
      },
    } satisfies FileNodeProps)
    : props;

  return createElement(BoundFileNode, nodeProps);
});

ImageNodeRoute.displayName = 'ImageNodeRoute';

export const fileNodeTypes: NodeTypes = {
  image: ImageNodeRoute,
  video: BoundFileNode,
  ply: BoundFileNode,
};

export const aiNodeRenderers: NodeTypes = {
  aiImageGen: BoundAIImageGenNode,
  aiImageInpaint: BoundAIImageInpaintNode,
  aiStoryboard: BoundAIStoryboardNode,
  aiModelRenderTransfer: BoundAIModelRenderTransferNode,
  aiImageToPly: BoundAIImageToPlyNode,
  aiMultiViewRestore: BoundAIMultiViewRestoreNode,
  aiImageHd: BoundAIImageHdNode,
  aiFloorplanColorize: BoundAIFloorplanColorizeNode,
  aiVideoGen: BoundAIVideoGenNode,
};

export const nodeTypes: NodeTypes = {
  [CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE]: DomWindowPlaceholderNode,
  ...fileNodeTypes,
  ...aiNodeRenderers,
};
