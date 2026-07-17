export interface CanvasImagePixiCoverTextureDescriptor {
  cropKey: string;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ResolveCanvasImagePixiCoverTextureDescriptorOptions {
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  itemWidth: number;
  itemHeight: number;
}

export function resolveCanvasImagePixiCoverTextureDescriptor({
  src,
  sourceWidth: inputSourceWidth,
  sourceHeight: inputSourceHeight,
  itemWidth,
  itemHeight,
}: ResolveCanvasImagePixiCoverTextureDescriptorOptions): CanvasImagePixiCoverTextureDescriptor {
  const normalizedSourceWidth = Math.max(1, Math.round(inputSourceWidth));
  const normalizedSourceHeight = Math.max(1, Math.round(inputSourceHeight));
  const targetAspect = Math.max(1, itemWidth) / Math.max(1, itemHeight);
  const sourceAspect = normalizedSourceWidth / normalizedSourceHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = normalizedSourceWidth;
  let sourceHeight = normalizedSourceHeight;

  if (sourceAspect > targetAspect) {
    sourceWidth = Math.max(1, Math.round(normalizedSourceHeight * targetAspect));
    sourceX = Math.max(0, Math.round((normalizedSourceWidth - sourceWidth) / 2));
  } else if (sourceAspect < targetAspect) {
    sourceHeight = Math.max(1, Math.round(normalizedSourceWidth / targetAspect));
    sourceY = Math.max(0, Math.round((normalizedSourceHeight - sourceHeight) / 2));
  }

  const cropKey = [
    src,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    Math.round(itemWidth),
    Math.round(itemHeight),
  ].join(':');

  return {
    cropKey,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  };
}
