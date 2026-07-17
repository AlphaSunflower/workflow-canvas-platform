import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject,
} from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';

import type { UseContextMenuReturn } from '@/hooks/ui';
import type { AnyNodeData, Position, Viewport } from '@/types';
import { isFileNodeData } from '@/utils';

import {
  clearPromotedCanvasNodeReason,
  promoteCanvasNode,
  requestCanvasNodeViewerOpen,
} from './canvas-active-node-state';
import { hitTestCanvasNode } from './canvas-hit-test';
import type { CanvasNodeSpatialIndex } from './canvas-node-spatial-index';
import type { CanvasContextMenuTargetContext } from './context-menu/types';
import type { ContextMenuItem } from '../ui/ContextMenu';

type FlowNode = Node<AnyNodeData>;
type PassiveNodePromotionReason = 'selected' | 'hovered' | 'context-menu';

interface UseCanvasContextInteractionsOptions {
  currentViewport: Viewport;
  nodesRef: MutableRefObject<FlowNode[]>;
  spatialIndexRef: MutableRefObject<CanvasNodeSpatialIndex>;
  reactFlowInstanceRef: MutableRefObject<ReactFlowInstance<AnyNodeData> | null>;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  setNodes: (nodes: FlowNode[]) => void;
  markRecentImageInteraction: (nodeId?: string | null) => void;
  getFlowPositionFromClient: (clientX: number, clientY: number) => Position;
  buildContextMenuActions: (
    target: CanvasContextMenuTargetContext,
  ) => ContextMenuItem[];
  contextMenu: Pick<UseContextMenuReturn, 'show'>;
}

interface UseCanvasContextInteractionsResult {
  hoveredNodeId: string | null;
  onNodeContextMenu: (
    event: ReactMouseEvent,
    node: Node,
  ) => void;
  onNodeClick: (
    event: ReactMouseEvent,
    node: Node,
  ) => void;
  onNodeDoubleClick: (
    event: ReactMouseEvent,
    node: Node,
  ) => void;
  onNodeMouseEnter: (
    event: ReactMouseEvent,
    node: Node,
  ) => void;
  onNodeMouseLeave: (
    event: ReactMouseEvent,
    node: Node,
  ) => void;
  onPaneClick: (event: ReactMouseEvent) => void;
  onPaneContextMenu: (event: ReactMouseEvent) => void;
  onCanvasContainerDoubleClickCapture: (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
}

export function useCanvasContextInteractions(
  options: UseCanvasContextInteractionsOptions,
): UseCanvasContextInteractionsResult {
  const {
    currentViewport,
    nodesRef,
    spatialIndexRef,
    reactFlowInstanceRef,
    canvasContainerRef,
    setNodes,
    markRecentImageInteraction,
    getFlowPositionFromClient,
    buildContextMenuActions,
    contextMenu,
  } = options;
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const promotedHoverNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previousHoveredNodeId = promotedHoverNodeIdRef.current;
    if (previousHoveredNodeId && previousHoveredNodeId !== hoveredNodeId) {
      clearPromotedCanvasNodeReason(previousHoveredNodeId, 'hovered');
    }

    promotedHoverNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  useEffect(() => {
    return (): void => {
      if (promotedHoverNodeIdRef.current) {
        clearPromotedCanvasNodeReason(promotedHoverNodeIdRef.current, 'hovered');
      }
    };
  }, []);

  const getCanvasHitNode = useCallback(
    (clientX: number, clientY: number): FlowNode | null => {
      const viewport =
        reactFlowInstanceRef.current?.getViewport() ?? currentViewport;
      const hit = hitTestCanvasNode({
        clientPosition: { x: clientX, y: clientY },
        viewport,
        nodes: nodesRef.current,
        spatialIndex: spatialIndexRef.current,
        containerBounds:
          canvasContainerRef.current?.getBoundingClientRect(),
      });

      if (!hit) {
        return null;
      }

      const node = nodesRef.current.find((entry) => entry.id === hit.node.id);
      return node ?? null;
    },
    [
      canvasContainerRef,
      currentViewport,
      nodesRef,
      reactFlowInstanceRef,
      spatialIndexRef,
    ],
  );

  const selectCanvasNode = useCallback(
    (nodeId: string): void => {
      const nextNodes = nodesRef.current.map((node) => ({
        ...node,
        selected: node.id === nodeId,
      }));

      setNodes(nextNodes);
      nodesRef.current = nextNodes;
    },
    [nodesRef, setNodes],
  );

  const promotePassiveNode = useCallback(
    (
      nodeId: string,
      reasons: PassiveNodePromotionReason[],
    ): void => {
      promoteCanvasNode(nodeId, reasons);
    },
    [],
  );

  const openNodeContextMenu = useCallback(
    (
      position: Position,
      node: FlowNode,
    ): void => {
      contextMenu.show(
        position,
        buildContextMenuActions({
          kind: 'node',
          nodeId: node.id,
          nodeType: node.data.type,
          nodeData: node.data,
        }),
        {
          type: 'node',
          nodeId: node.id,
        },
      );
    },
    [buildContextMenuActions, contextMenu],
  );

  const routePassiveNodeDoubleClick = useCallback(
    (node: FlowNode): void => {
      if (!isFileNodeData(node.data) || node.data.type !== 'image') {
        return;
      }

      promotePassiveNode(node.id, ['selected']);
      selectCanvasNode(node.id);
      requestCanvasNodeViewerOpen(node.id);
      markRecentImageInteraction(node.id);
    },
    [markRecentImageInteraction, promotePassiveNode, selectCanvasNode],
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node): void => {
      event.preventDefault();
      markRecentImageInteraction(node.id);
      promotePassiveNode(node.id, ['context-menu']);
      openNodeContextMenu({ x: event.clientX, y: event.clientY }, node);
    },
    [markRecentImageInteraction, openNodeContextMenu, promotePassiveNode],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent): void => {
      event.preventDefault();
      const hitNode = getCanvasHitNode(event.clientX, event.clientY);

      if (hitNode) {
        markRecentImageInteraction(hitNode.id);
        promotePassiveNode(hitNode.id, ['context-menu']);
        openNodeContextMenu(
          { x: event.clientX, y: event.clientY },
          hitNode,
        );
        return;
      }

      const flowPosition = getFlowPositionFromClient(
        event.clientX,
        event.clientY,
      );

      contextMenu.show(
        { x: event.clientX, y: event.clientY },
        buildContextMenuActions({ kind: 'canvas', position: flowPosition }),
        {
          type: 'canvas',
          position: flowPosition,
        },
      );
    },
    [
      buildContextMenuActions,
      contextMenu,
      getCanvasHitNode,
      getFlowPositionFromClient,
      markRecentImageInteraction,
      openNodeContextMenu,
      promotePassiveNode,
    ],
  );

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node): void => {
      promotePassiveNode(node.id, ['selected']);
      markRecentImageInteraction(node.id);
    },
    [markRecentImageInteraction, promotePassiveNode],
  );

  const onNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node): void => {
      const flowNode = nodesRef.current.find((entry) => entry.id === node.id);
      if (!flowNode) {
        return;
      }

      routePassiveNodeDoubleClick(flowNode);
    },
    [nodesRef, routePassiveNodeDoubleClick],
  );

  const onPaneClick = useCallback(
    (event: ReactMouseEvent): void => {
      const hitNode = getCanvasHitNode(event.clientX, event.clientY);
      if (!hitNode) {
        return;
      }

      promotePassiveNode(hitNode.id, ['selected']);
      selectCanvasNode(hitNode.id);
      markRecentImageInteraction(hitNode.id);
    },
    [
      getCanvasHitNode,
      markRecentImageInteraction,
      promotePassiveNode,
      selectCanvasNode,
    ],
  );

  const onCanvasContainerDoubleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const target = event.target instanceof Element ? event.target : null;
      const eventNode = target?.closest('.react-flow__node');
      if (eventNode && !target?.closest('[data-file-node-proxy="true"]')) {
        return;
      }

      const hitNode = getCanvasHitNode(event.clientX, event.clientY);
      if (!hitNode) {
        return;
      }

      routePassiveNodeDoubleClick(hitNode);
    },
    [getCanvasHitNode, routePassiveNodeDoubleClick],
  );

  const onNodeMouseEnter = useCallback(
    (_event: ReactMouseEvent, node: Node): void => {
      promotePassiveNode(node.id, ['hovered']);
      setHoveredNodeId((current) =>
        current === node.id ? current : node.id,
      );
    },
    [promotePassiveNode],
  );

  const onNodeMouseLeave = useCallback(
    (_event: ReactMouseEvent, node: Node): void => {
      setHoveredNodeId((current) =>
        current === node.id ? null : current,
      );
    },
    [],
  );

  return {
    hoveredNodeId,
    onNodeContextMenu,
    onNodeClick,
    onNodeDoubleClick,
    onNodeMouseEnter,
    onNodeMouseLeave,
    onPaneClick,
    onPaneContextMenu,
    onCanvasContainerDoubleClickCapture,
  };
}
