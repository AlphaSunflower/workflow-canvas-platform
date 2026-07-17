import type { FileMetadata } from '@/types/file.types';
import type {
  FileNodeData,
  ImageAsset,
  ImageAssetIntrinsicSize,
  ImageAssetSource,
  ImageAssetVariant,
  ImageAssetVariantKind,
  ImageAssetVariants,
} from '@/types/node.types';
import type {
  ImageCanvasSelection,
  ImageResourceMode,
  ImageViewerSelection,
  ResolvedFileNodeImageAsset,
  ResolvedImageVariant,
} from './image-resource.types';

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getIntrinsicSize(metadata: Pick<FileMetadata, 'width' | 'height'> = {}): ImageAssetIntrinsicSize | undefined {
  if (
    typeof metadata.width !== 'number' ||
    metadata.width <= 0 ||
    typeof metadata.height !== 'number' ||
    metadata.height <= 0
  ) {
    return undefined;
  }

  return {
    width: metadata.width,
    height: metadata.height,
  };
}

function compactVariants(variants: Partial<ImageAssetVariants>): ImageAssetVariants {
  const nextVariants: ImageAssetVariants = {};

  (Object.keys(variants) as ImageAssetVariantKind[]).forEach((kind) => {
    const variant = variants[kind];
    if (isNonEmptyString(variant?.url)) {
      nextVariants[kind] = variant;
    }
  });

  return nextVariants;
}

function resolveVariant(
  kind: ImageAssetVariantKind,
  assetVariant: ImageAssetVariant | undefined,
  legacyUrl?: string
): ResolvedImageVariant | undefined {
  if (isNonEmptyString(assetVariant?.url)) {
    return {
      kind,
      url: assetVariant.url,
      fromLegacy: false,
      asset: {
        ...assetVariant,
      },
    };
  }

  if (isNonEmptyString(legacyUrl)) {
    return {
      kind,
      url: legacyUrl,
      fromLegacy: true,
    };
  }

  return undefined;
}

export function createEmptyImageAsset(
  fileId?: string,
  metadata: Partial<Pick<FileMetadata, 'width' | 'height'>> = {},
  source: ImageAssetSource = 'unknown'
): ImageAsset {
  return {
    assetId: fileId,
    source,
    variants: {},
    intrinsicSize: getIntrinsicSize(metadata),
    version: 1,
  };
}

export function createImageAssetVariant(
  url: string | undefined,
  options: {
    width?: number;
    height?: number;
    mimeType?: string;
    updatedAt?: number;
  } = {}
): ImageAssetVariant | undefined {
  if (!isNonEmptyString(url)) {
    return undefined;
  }

  return {
    url,
    ...(typeof options.width === 'number' && options.width > 0 ? { width: options.width } : {}),
    ...(typeof options.height === 'number' && options.height > 0 ? { height: options.height } : {}),
    ...(isNonEmptyString(options.mimeType) ? { mimeType: options.mimeType } : {}),
    ...(typeof options.updatedAt === 'number' ? { updatedAt: options.updatedAt } : {}),
  };
}

export function upsertImageAsset(
  imageAsset: ImageAsset | undefined,
  options: {
    fileId?: string;
    source?: ImageAssetSource;
    metadata?: Partial<Pick<FileMetadata, 'width' | 'height'>>;
    variants?: Partial<ImageAssetVariants>;
    version?: number;
  } = {}
): ImageAsset {
  const baseAsset = imageAsset ?? createEmptyImageAsset(options.fileId, options.metadata, options.source ?? 'unknown');

  return {
    ...baseAsset,
    assetId: options.fileId ?? baseAsset.assetId,
    source: options.source ?? baseAsset.source,
    variants: compactVariants({
      ...baseAsset.variants,
      ...options.variants,
    }),
    intrinsicSize: getIntrinsicSize(options.metadata ?? {}) ?? baseAsset.intrinsicSize,
    version: options.version ?? (imageAsset ? imageAsset.version + 1 : baseAsset.version),
  };
}

export function createLocalImageAsset(
  fileId: string,
  metadata: Partial<Pick<FileMetadata, 'width' | 'height'>> = {},
  variants: Partial<ImageAssetVariants> = {},
  options: {
    previous?: ImageAsset;
    version?: number;
  } = {}
): ImageAsset {
  return upsertImageAsset(options.previous, {
    fileId,
    source: 'local',
    metadata,
    variants,
    version: options.version,
  });
}

export function removeImageAssetVariant(
  imageAsset: ImageAsset | undefined,
  variantKind: ImageAssetVariantKind
): ImageAsset | undefined {
  if (!imageAsset?.variants[variantKind]) {
    return imageAsset;
  }

  const nextVariants = compactVariants({
    ...imageAsset.variants,
    [variantKind]: undefined,
  });

  return {
    ...imageAsset,
    variants: nextVariants,
    version: imageAsset.version + 1,
  };
}

export function resolveFileNodeImageAsset(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): ResolvedFileNodeImageAsset {
  const asset = node.imageAsset ?? createEmptyImageAsset(node.fileId, node.metadata);
  const thumbnail = resolveVariant('thumbnail', asset.variants.thumbnail, node.thumbnailUrl);
  const original = resolveVariant('original', asset.variants.original);

  return {
    asset,
    thumbnail,
    original,
    preferred: thumbnail,
  };
}

/**
 * @deprecated This helper only returns the original image URL and is kept for
 * explicit original-resource consumers. Do not use it for node input previews.
 * Node input previews must go through NodeInputImagePreview / useImageResource
 * so local runtime thumbnails and protected resource resolution continue to work.
 * Prefer getFileNodeImageOriginalUrl() when the caller explicitly needs the
 * original asset URL.
 */
export function getFileNodeImagePrimaryUrl(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): string | undefined {
  return getFileNodeImageOriginalUrl(node);
}

export function selectCanvasImageVariant(
  resolved: ResolvedFileNodeImageAsset,
  _displaySize?: {
    width?: number;
    height?: number;
  },
  options: {
    currentVariantKind?: ImageAssetVariantKind;
  } = {}
): ImageCanvasSelection {
  void options.currentVariantKind;
  const preferred = resolved.thumbnail;

  return {
    variant: preferred,
    preferred,
  };
}

export function getFileNodeImageCanvasVariant(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>,
  displaySize?: {
    width?: number;
    height?: number;
  }
): ResolvedImageVariant | undefined {
  return selectCanvasImageVariant(resolveFileNodeImageAsset(node), displaySize).variant;
}

export function getFileNodeImageCanvasUrl(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>,
  displaySize?: {
    width?: number;
    height?: number;
  }
): string | undefined {
  return getFileNodeImageCanvasVariant(node, displaySize)?.url;
}

export function getFileNodeImageThumbnailUrl(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): string | undefined {
  return resolveFileNodeImageAsset(node).thumbnail?.url;
}

export function getFileNodeImageOriginalUrl(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): string | undefined {
  return resolveFileNodeImageAsset(node).original?.url;
}

export function getFileNodeImageViewerUrl(
  node: Pick<FileNodeData, 'fileId' | 'imageAsset' | 'thumbnailUrl' | 'metadata'>
): string | undefined {
  return selectViewerImageVariant(resolveFileNodeImageAsset(node)).variant?.url;
}

export function selectViewerImageVariant(resolved: ResolvedFileNodeImageAsset): ImageViewerSelection {
  const requested = resolved.original;

  return {
    variant: requested,
    requestedKind: 'original',
    requested,
  };
}

export function getImageVariantUrls(
  resolved: ResolvedFileNodeImageAsset,
  mode: ImageResourceMode,
  preferredUrl?: string
): string[] {
  void preferredUrl;
  const rawCandidates = mode === 'original'
    ? [resolved.original?.url]
    : [resolved.thumbnail?.url];

  return rawCandidates
    .filter((value): value is string => Boolean(value))
    .filter((value, index, collection) => collection.indexOf(value) === index);
}
