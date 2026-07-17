import type {
  AnyNodeData,
  FileImportSessionGuard,
  FileMetadata,
  NodeId,
  NodeType,
  Position,
} from '../../types';
import type { BrowserFileSystemFileHandleLike } from '../../services/local-file-source-store';
import {
  calculateFileNodeDimensions,
  createDefaultFileNodeData,
  generateUUID,
} from '../../utils';
import { runWithConcurrency } from '../../utils/performance/async-pool';

export const FILE_IMPORT_BATCH_COLUMNS = 5;
export const FILE_IMPORT_BATCH_ROWS = 2;
export const FILE_IMPORT_BATCH_SIZE = FILE_IMPORT_BATCH_COLUMNS * FILE_IMPORT_BATCH_ROWS;
export const FILE_IMPORT_BATCH_COLUMN_GAP = 20;
export const FILE_IMPORT_BATCH_ROW_GAP = 20;
export const FILE_IMPORT_BATCH_GAP_Y = 200;
export const FILE_IMPORT_PROBE_CONCURRENCY = 3;

export type FileCanvasNodeType = Extract<NodeType, 'image' | 'video' | 'ply'>;

export interface EligibleImportFile {
  file: File;
  nodeType: FileCanvasNodeType;
  mimeType: string;
  localSourceHandle?: BrowserFileSystemFileHandleLike;
}

export interface ProbedImportFile extends EligibleImportFile {
  metadata: FileMetadata;
}

export interface PositionedImportFile extends ProbedImportFile {
  nodeId: NodeId;
  position: Position;
}

export interface FileImportTask {
  batchId: string;
  file: File;
  localSourceHandle?: BrowserFileSystemFileHandleLike;
  nodeId: NodeId;
  fileId: string;
  nodeType: FileCanvasNodeType;
  metadata: FileMetadata;
  sessionId: string;
}

export interface PlaceholderImportBatch {
  tasks: FileImportTask[];
  nodes: AnyNodeData[];
}

export function createImportTaskSessionGuard(
  task: Pick<FileImportTask, 'nodeId' | 'fileId' | 'sessionId'>,
): FileImportSessionGuard {
  return {
    nodeId: task.nodeId.value,
    fileId: task.fileId,
    sessionId: task.sessionId,
  };
}

interface LayoutBatchEntry extends ProbedImportFile {
  batchIndex: number;
  dimensions: {
    width: number;
    height: number;
  };
}

export async function probeImportFilesForLayout(
  files: EligibleImportFile[],
  probeMetadata: (file: EligibleImportFile) => Promise<FileMetadata>,
  onProbeError?: (file: EligibleImportFile, error: unknown) => void,
  concurrency = FILE_IMPORT_PROBE_CONCURRENCY,
): Promise<ProbedImportFile[]> {
  return runWithConcurrency(files, concurrency, async (entry) => {
    try {
      const metadata = await probeMetadata(entry);
      return {
        ...entry,
        metadata,
      };
    } catch (error) {
      onProbeError?.(entry, error);
      return {
        ...entry,
        metadata: {},
      };
    }
  });
}

export function buildPositionedImportFiles(
  files: ProbedImportFile[],
  position: Position,
  getNextNodeIds: (count: number) => NodeId[],
): PositionedImportFile[] {
  const nextNodeIds = getNextNodeIds(files.length);
  const positionedFiles: PositionedImportFile[] = [];
  let batchTopY = position.y;

  for (let batchStart = 0; batchStart < files.length; batchStart += FILE_IMPORT_BATCH_SIZE) {
    const batchFiles: LayoutBatchEntry[] = files
      .slice(batchStart, batchStart + FILE_IMPORT_BATCH_SIZE)
      .map((entry, batchIndex) => ({
        ...entry,
        batchIndex,
        dimensions: calculateFileNodeDimensions(entry.nodeType, entry.metadata),
      }));

    const columnWidths = Array.from({ length: FILE_IMPORT_BATCH_COLUMNS }, (_, columnIndex) => (
      batchFiles.reduce((maxWidth, entry) => (
        entry.batchIndex % FILE_IMPORT_BATCH_COLUMNS === columnIndex
          ? Math.max(maxWidth, entry.dimensions.width)
          : maxWidth
      ), 0)
    ));

    const rowHeights = Array.from({ length: FILE_IMPORT_BATCH_ROWS }, (_, rowIndex) => (
      batchFiles.reduce((maxHeight, entry) => (
        Math.floor(entry.batchIndex / FILE_IMPORT_BATCH_COLUMNS) === rowIndex
          ? Math.max(maxHeight, entry.dimensions.height)
          : maxHeight
      ), 0)
    ));

    const columnOffsets: number[] = [];
    let currentX = position.x;
    for (let columnIndex = 0; columnIndex < FILE_IMPORT_BATCH_COLUMNS; columnIndex += 1) {
      columnOffsets[columnIndex] = currentX;
      currentX += columnWidths[columnIndex] + FILE_IMPORT_BATCH_COLUMN_GAP;
    }

    const rowOffsets: number[] = [];
    let currentY = batchTopY;
    for (let rowIndex = 0; rowIndex < FILE_IMPORT_BATCH_ROWS; rowIndex += 1) {
      rowOffsets[rowIndex] = currentY;
      currentY += rowHeights[rowIndex] + FILE_IMPORT_BATCH_ROW_GAP;
    }

    batchFiles.forEach((entry) => {
      const rowIndex = Math.floor(entry.batchIndex / FILE_IMPORT_BATCH_COLUMNS);
      const columnIndex = entry.batchIndex % FILE_IMPORT_BATCH_COLUMNS;

      positionedFiles.push({
        file: entry.file,
        nodeType: entry.nodeType,
        mimeType: entry.mimeType,
        metadata: entry.metadata,
        nodeId: nextNodeIds[batchStart + entry.batchIndex],
        position: {
          x: columnOffsets[columnIndex],
          y: rowOffsets[rowIndex],
        },
      });
    });

    const usedRows = rowHeights.filter((height) => height > 0);
    const batchHeight = usedRows.reduce((sum, height) => sum + height, 0)
      + Math.max(usedRows.length - 1, 0) * FILE_IMPORT_BATCH_ROW_GAP;

    batchTopY += batchHeight + FILE_IMPORT_BATCH_GAP_Y;
  }

  return positionedFiles;
}

export function createPlaceholderImportBatch(
  batchId: string,
  files: PositionedImportFile[],
  createSessionId: () => string = generateUUID,
): PlaceholderImportBatch {
  const preparedTasks = files.map((entry) => {
    const fileId = entry.nodeId.value;
    const node = createDefaultFileNodeData(
      entry.nodeId,
      entry.position,
      entry.nodeType,
      fileId,
      entry.file.name,
      entry.file.size,
      entry.mimeType,
      entry.metadata,
    );

    node.status = entry.nodeType === 'image' ? 'idle' : 'pending';

    return {
      task: {
        batchId,
        file: entry.file,
        localSourceHandle: entry.localSourceHandle,
        nodeId: entry.nodeId,
        fileId,
        nodeType: entry.nodeType,
        metadata: entry.metadata,
        sessionId: createSessionId(),
      } satisfies FileImportTask,
      node,
    };
  });

  return {
    tasks: preparedTasks.map(({ task }) => task),
    nodes: preparedTasks.map(({ node }) => node),
  };
}

export async function initializeImportBatch(options: {
  batchId: string;
  files: EligibleImportFile[];
  position: Position;
  getNextNodeIds: (count: number) => NodeId[];
  probeMetadata: (file: EligibleImportFile) => Promise<FileMetadata>;
  onProbeError?: (file: EligibleImportFile, error: unknown) => void;
  probeConcurrency?: number;
  createSessionId?: () => string;
}): Promise<{
  probedFiles: ProbedImportFile[];
  positionedFiles: PositionedImportFile[];
  placeholderBatch: PlaceholderImportBatch;
}> {
  const probedFiles = await probeImportFilesForLayout(
    options.files,
    options.probeMetadata,
    options.onProbeError,
    options.probeConcurrency,
  );
  const positionedFiles = buildPositionedImportFiles(
    probedFiles,
    options.position,
    options.getNextNodeIds,
  );
  const placeholderBatch = createPlaceholderImportBatch(
    options.batchId,
    positionedFiles,
    options.createSessionId,
  );

  return {
    probedFiles,
    positionedFiles,
    placeholderBatch,
  };
}
