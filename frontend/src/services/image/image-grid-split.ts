export const IMAGE_GRID_SPLIT_MIN_SIZE = 1;
export const IMAGE_GRID_SPLIT_MAX_SIZE = 6;

export interface ImageGridSplitGrid {
  rows: number;
  cols: number;
}

export interface ImageGridSplitOptions extends ImageGridSplitGrid {
  sourceName?: string;
  outputMimeType?: 'image/png';
}

export interface ImageGridSplitTile {
  file: File;
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface ImageGridSplitTileRect {
  row: number;
  col: number;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

function validateGridSize(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }

  if (value < IMAGE_GRID_SPLIT_MIN_SIZE || value > IMAGE_GRID_SPLIT_MAX_SIZE) {
    throw new Error(`${label} must be between ${IMAGE_GRID_SPLIT_MIN_SIZE} and ${IMAGE_GRID_SPLIT_MAX_SIZE}.`);
  }
}

export function validateImageGridSplitGrid(grid: ImageGridSplitGrid): ImageGridSplitGrid {
  validateGridSize(grid.rows, 'Rows');
  validateGridSize(grid.cols, 'Columns');

  return {
    rows: grid.rows,
    cols: grid.cols,
  };
}

function getBaseName(fileName: string | undefined): string {
  const normalized = typeof fileName === 'string' && fileName.trim().length > 0
    ? fileName.trim()
    : 'image';
  const extensionStart = normalized.lastIndexOf('.');

  if (extensionStart <= 0) {
    return normalized;
  }

  return normalized.slice(0, extensionStart);
}

function createTileFileName(sourceName: string | undefined, row: number, col: number): string {
  return `${getBaseName(sourceName)}_r${row}_c${col}.png`;
}

function createImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = (): void => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = (): void => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image.'));
    };
    image.src = objectUrl;
  });
}

async function decodeImageSource(blob: Blob): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const image = await createImageFromBlob(blob);
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export image tile.'));
        return;
      }

      resolve(blob);
    }, mimeType);
  });
}

export function createImageGridSplitTileRects(
  width: number,
  height: number,
  grid: ImageGridSplitGrid,
): ImageGridSplitTileRect[] {
  const normalizedGrid = validateImageGridSplitGrid(grid);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Image dimensions are invalid.');
  }

  if (width < normalizedGrid.cols || height < normalizedGrid.rows) {
    throw new Error('Image dimensions are smaller than the split grid.');
  }

  const baseTileWidth = Math.floor(width / normalizedGrid.cols);
  const baseTileHeight = Math.floor(height / normalizedGrid.rows);
  const rects: ImageGridSplitTileRect[] = [];

  for (let rowIndex = 0; rowIndex < normalizedGrid.rows; rowIndex += 1) {
    const sourceY = rowIndex * baseTileHeight;
    const tileHeight = rowIndex === normalizedGrid.rows - 1
      ? height - sourceY
      : baseTileHeight;

    for (let colIndex = 0; colIndex < normalizedGrid.cols; colIndex += 1) {
      const sourceX = colIndex * baseTileWidth;
      const tileWidth = colIndex === normalizedGrid.cols - 1
        ? width - sourceX
        : baseTileWidth;

      rects.push({
        row: rowIndex + 1,
        col: colIndex + 1,
        sourceX,
        sourceY,
        width: tileWidth,
        height: tileHeight,
      });
    }
  }

  return rects;
}

export async function splitImageIntoGrid(
  source: Blob,
  options: ImageGridSplitOptions,
): Promise<ImageGridSplitTile[]> {
  const grid = validateImageGridSplitGrid(options);
  const mimeType = options.outputMimeType ?? 'image/png';
  const image = await decodeImageSource(source);

  if (image.width <= 0 || image.height <= 0) {
    throw new Error('Image dimensions are invalid.');
  }

  const rects = createImageGridSplitTileRects(image.width, image.height, grid);
  const tiles: ImageGridSplitTile[] = [];

  for (const rect of rects) {
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to initialize image tile canvas.');
    }

    context.drawImage(
      image.source,
      rect.sourceX,
      rect.sourceY,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );

    const blob = await canvasToBlob(canvas, mimeType);
    tiles.push({
      file: new File([blob], createTileFileName(options.sourceName, rect.row, rect.col), {
        type: mimeType,
        lastModified: Date.now(),
      }),
      row: rect.row,
      col: rect.col,
      width: rect.width,
      height: rect.height,
    });
  }

  image.close?.();

  return tiles;
}
