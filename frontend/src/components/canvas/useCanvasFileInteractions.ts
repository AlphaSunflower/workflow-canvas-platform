import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Node } from 'reactflow';
import type { ContextMenuItem } from '../ui/ContextMenu';
import type { AnyNodeData, FileNodeData, Position } from '@/types';
import type { BrowserFileSystemFileHandleLike } from '@/services/local-file-source-store';
import { browserFileService } from '@/services/browser-file';
import { backendFileService } from '@/services/backendFileService';
import { resolveFileResource } from '@/services/file-resource';
import {
  splitImageIntoGrid,
  type ImageGridSplitGrid,
} from '@/services/image/image-grid-split';
import { isFileNodeData } from '@/utils';
import { buildContextMenuItems } from './context-menu/builders';
import type { ImageGridSplitMenuSelection } from './context-menu/types';
import { aiNodeDefinitions } from '@/nodes/definitions';
import type { UseNotificationReturn } from '@/hooks/ui/useNotification';

type CreatableNodeType = Exclude<
  AnyNodeData['type'],
  'image' | 'video' | 'ply'
>;

type FlowNode = Node<AnyNodeData>;

type ImportSelection = Array<{
  file: File;
  localSourceHandle?: BrowserFileSystemFileHandleLike;
}>;

interface UseCanvasFileInteractionsOptions {
  fileInputRef: RefObject<HTMLInputElement | null>;
  nodes: FlowNode[];
  workflowId?: string | null;
  actions: {
    ensureMaterializedWorkflow: () => Promise<unknown>;
    exportFileNode: (
      nodeId: string,
      options?: { forceDirectoryPicker?: boolean },
    ) => Promise<void>;
    rebindLocalFileNodeSource: (
      nodeId: string,
      file: File,
      options?: {
        localSourceHandle?: BrowserFileSystemFileHandleLike;
      },
    ) => Promise<FileNodeData | null>;
  };
  notification: Pick<UseNotificationReturn, 'showWarning' | 'showError' | 'showSuccess'>;
  importFilesToCanvas: (
    files: ImportSelection,
    position: Position,
  ) => Promise<void>;
  appendCreatedNode: (
    type: CreatableNodeType,
    position: Position,
  ) => void;
  removeNodeLocally: (nodeId: string) => void;
  patchReboundFileNode: (
    nodeId: string,
    reboundNode: FileNodeData,
  ) => void;
}

interface UseCanvasFileInteractionsResult {
  propertyDialogNode: FileNodeData | null;
  imageGridSplitDialogNode: FileNodeData | null;
  isSplittingImageGrid: boolean;
  closePropertyDialog: () => void;
  closeImageGridSplitDialog: () => void;
  confirmCustomImageGridSplit: (grid: ImageGridSplitGrid) => void;
  handleRebindPropertyDialogFile: (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ) => Promise<FileNodeData | null>;
  handleFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  buildContextMenuActions: (
    target:
      | { kind: 'canvas'; position: Position }
      | {
          kind: 'node';
          nodeId: string;
          nodeType: AnyNodeData['type'];
          nodeData: AnyNodeData;
        },
  ) => ContextMenuItem[];
}

export function useCanvasFileInteractions(
  options: UseCanvasFileInteractionsOptions,
): UseCanvasFileInteractionsResult {
  const {
    fileInputRef,
    nodes,
    workflowId,
    actions,
    notification,
    importFilesToCanvas,
    appendCreatedNode,
    removeNodeLocally,
    patchReboundFileNode,
  } = options;
  const [propertyDialogNode, setPropertyDialogNode] =
    useState<FileNodeData | null>(null);
  const [imageGridSplitDialogNode, setImageGridSplitDialogNode] =
    useState<FileNodeData | null>(null);
  const [isSplittingImageGrid, setIsSplittingImageGrid] = useState(false);
  const pendingImportPositionRef = useRef<Position | null>(null);

  useEffect(() => {
    if (!propertyDialogNode) {
      return;
    }

    const latestNode = nodes.find(
      (node) => node.id === propertyDialogNode.id.value,
    );
    if (!latestNode || !isFileNodeData(latestNode.data)) {
      setPropertyDialogNode(null);
      return;
    }

    if (latestNode.data !== propertyDialogNode) {
      setPropertyDialogNode(latestNode.data);
    }
  }, [nodes, propertyDialogNode]);

  useEffect(() => {
    if (!imageGridSplitDialogNode) {
      return;
    }

    const latestNode = nodes.find(
      (node) => node.id === imageGridSplitDialogNode.id.value,
    );
    if (!latestNode || !isFileNodeData(latestNode.data) || latestNode.data.type !== 'image') {
      setImageGridSplitDialogNode(null);
      return;
    }

    if (latestNode.data !== imageGridSplitDialogNode) {
      setImageGridSplitDialogNode(latestNode.data);
    }
  }, [imageGridSplitDialogNode, nodes]);

  const openFilePicker = useCallback((position: Position): void => {
    pendingImportPositionRef.current = position;

    if (!browserFileService.supportsFileSystemAccessFilePicker()) {
      fileInputRef.current?.click();
      return;
    }

    void (async (): Promise<void> => {
      const picked = await browserFileService.pickFilesWithHandles({
        multiple: true,
        types: [
          {
            description: 'Media files',
            accept: {
              'image/*': [
                '.png',
                '.jpg',
                '.jpeg',
                '.gif',
                '.webp',
                '.bmp',
                '.svg',
              ],
              'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
              'application/octet-stream': ['.ply'],
            },
          },
        ],
      });

      if (!picked.success) {
        notification.showWarning(
          '导入回退',
          '浏览器文件句柄选择失败，已回退普通文件选择。',
        );
        fileInputRef.current?.click();
        return;
      }

      pendingImportPositionRef.current = null;
      if (!picked.data || picked.data.length === 0) {
        return;
      }

      await importFilesToCanvas(
        picked.data.map((entry) => ({
          file: entry.file,
          localSourceHandle: entry.handle,
        })),
        position,
      );
    })();
  }, [fileInputRef, importFilesToCanvas, notification]);

  const openFilePropertyDialog = useCallback((nodeId: string): void => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node || !isFileNodeData(node.data)) {
      return;
    }

    setPropertyDialogNode(node.data);
  }, [nodes]);

  const handleRebindPropertyDialogFile = useCallback(async (
    nodeId: string,
    file: File,
    options?: {
      localSourceHandle?: BrowserFileSystemFileHandleLike;
    },
  ): Promise<FileNodeData | null> => {
    const reboundNode = await actions.rebindLocalFileNodeSource(
      nodeId,
      file,
      options,
    );
    if (!reboundNode) {
      return null;
    }

    patchReboundFileNode(nodeId, reboundNode);
    setPropertyDialogNode(reboundNode);
    return reboundNode;
  }, [actions, patchReboundFileNode]);

  const handleFileInputChange = useCallback((
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const pendingPosition = pendingImportPositionRef.current;

    if (selectedFiles.length > 0 && pendingPosition) {
      void importFilesToCanvas(
        selectedFiles.map((file) => ({ file })),
        pendingPosition,
      );
    }

    event.target.value = '';
    pendingImportPositionRef.current = null;
  }, [importFilesToCanvas]);

  const splitImageNode = useCallback(async (
    nodeId: string,
    grid: ImageGridSplitGrid,
  ): Promise<void> => {
    const flowNode = nodes.find((item) => item.id === nodeId);
    if (!flowNode || !isFileNodeData(flowNode.data) || flowNode.data.type !== 'image') {
      notification.showError('拆分失败', '当前节点不是可拆分的图片节点。');
      return;
    }

    setIsSplittingImageGrid(true);
    let resourceHandle: Awaited<ReturnType<typeof resolveFileResource>> | null = null;
    try {
      try {
        resourceHandle = await resolveFileResource(flowNode.data, {
          purpose: 'export-original',
          require: 'file',
          workflowId: workflowId ?? null,
          owner: `image-grid-split:${flowNode.id}:${flowNode.data.fileId}`,
        });
      } catch {
        await backendFileService.ensureBackendFileId(flowNode.data, {
          purpose: 'upload-input',
          workflowId: workflowId ?? null,
        });
        resourceHandle = await resolveFileResource(flowNode.data, {
          purpose: 'export-original',
          require: 'file',
          workflowId: workflowId ?? null,
          owner: `image-grid-split:${flowNode.id}:${flowNode.data.fileId}:backend-ready`,
        });
      }

      if (!resourceHandle.file) {
        throw new Error('Original image file is unavailable.');
      }

      const tiles = await splitImageIntoGrid(resourceHandle.file, {
        rows: grid.rows,
        cols: grid.cols,
        sourceName: flowNode.data.fileName,
      });
      const importPosition: Position = {
        x: flowNode.position.x + flowNode.data.dimensions.width + 40,
        y: flowNode.position.y,
      };

      await importFilesToCanvas(
        tiles.map((tile) => ({ file: tile.file })),
        importPosition,
      );
      setImageGridSplitDialogNode(null);
      notification.showSuccess('拆分完成', `已创建 ${tiles.length} 个图片切片。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片拆分失败。';
      notification.showError('拆分失败', message);
    } finally {
      resourceHandle?.release();
      setIsSplittingImageGrid(false);
    }
  }, [importFilesToCanvas, nodes, notification, workflowId]);

  const handleSplitImageNode = useCallback((
    nodeId: string,
    selection: ImageGridSplitMenuSelection,
  ): void => {
    const flowNode = nodes.find((item) => item.id === nodeId);
    if (!flowNode || !isFileNodeData(flowNode.data) || flowNode.data.type !== 'image') {
      notification.showError('拆分失败', '当前节点不是可拆分的图片节点。');
      return;
    }

    if (selection.kind === 'custom') {
      setImageGridSplitDialogNode(flowNode.data);
      return;
    }

    void splitImageNode(nodeId, {
      rows: selection.rows,
      cols: selection.cols,
    });
  }, [nodes, notification, splitImageNode]);

  const confirmCustomImageGridSplit = useCallback((grid: ImageGridSplitGrid): void => {
    if (!imageGridSplitDialogNode || isSplittingImageGrid) {
      return;
    }

    void splitImageNode(imageGridSplitDialogNode.id.value, grid);
  }, [imageGridSplitDialogNode, isSplittingImageGrid, splitImageNode]);

  const closeImageGridSplitDialog = useCallback((): void => {
    if (isSplittingImageGrid) {
      return;
    }
    setImageGridSplitDialogNode(null);
  }, [isSplittingImageGrid]);

  const buildContextMenuActions = useCallback((
    target:
      | { kind: 'canvas'; position: Position }
      | {
          kind: 'node';
          nodeId: string;
          nodeType: AnyNodeData['type'];
          nodeData: AnyNodeData;
        },
  ): ContextMenuItem[] => {
    return buildContextMenuItems({
      target,
      aiNodeDefinitions,
      handlers: {
        onImportFiles: openFilePicker,
        onCreateNode: (type, position) => {
          void (async (): Promise<void> => {
            try {
              await actions.ensureMaterializedWorkflow();
              appendCreatedNode(type as CreatableNodeType, position);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : '创建画布失败';
              notification.showError('创建节点失败', message);
            }
          })();
        },
        onDeleteNode: removeNodeLocally,
        onOpenFileProperties: openFilePropertyDialog,
        onExportFileNode: (nodeId, exportOptions) => {
          void actions.exportFileNode(nodeId, exportOptions);
        },
        onSplitImageNode: handleSplitImageNode,
      },
    });
  }, [
    actions,
    appendCreatedNode,
    handleSplitImageNode,
    notification,
    openFilePicker,
    openFilePropertyDialog,
    removeNodeLocally,
  ]);

  return {
    propertyDialogNode,
    imageGridSplitDialogNode,
    isSplittingImageGrid,
    closePropertyDialog: () => setPropertyDialogNode(null),
    closeImageGridSplitDialog,
    confirmCustomImageGridSplit,
    handleRebindPropertyDialogFile,
    handleFileInputChange,
    buildContextMenuActions,
  };
}
