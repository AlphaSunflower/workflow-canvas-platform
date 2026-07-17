import {
  acquireProtectedResourceUrl,
  isProtectedResourceUrl,
} from '@/services/protected-resource';

export interface ReleasableImageHandle {
  close: () => void;
}

export type ImageLoadStrategy = 'decode' | 'display-url';

export function resolveCanvasDisplayUrlLoadingEnabled(
  override?: boolean,
  envValue: string | undefined = import.meta.env?.VITE_IMAGE_CANVAS_DISPLAY_URL_LOADING
): boolean {
  if (typeof override === 'boolean') {
    return override;
  }

  return envValue === 'true';
}

export function resolveCanvasLoadStrategy(
  override?: ImageLoadStrategy,
  options: {
    displayUrlEnabled?: boolean;
    envValue?: string;
  } = {}
): ImageLoadStrategy {
  if (override) {
    return override;
  }

  return resolveCanvasDisplayUrlLoadingEnabled(options.displayUrlEnabled, options.envValue)
    ? 'display-url'
    : 'decode';
}

export interface LoadedImageResource {
  src: string;
  width: number;
  height: number;
  decoded: 'bitmap' | 'image' | 'display-url';
  estimatedBytes: number;
  handle?: ReleasableImageHandle;
}

export interface ImageResourceLoadOptions {
  preferPersistentCache?: boolean;
  persistentVersion?: string;
  resizeWidth?: number;
  resizeHeight?: number;
}

function estimateBytes(width: number, height: number): number {
  return Math.max(0, width) * Math.max(0, height) * 4;
}

function resolveBitmapResizeOptions(
  options: ImageResourceLoadOptions,
): ImageBitmapOptions | undefined {
  const resizeWidth = Number.isFinite(options.resizeWidth)
    ? Math.max(1, Math.round(options.resizeWidth ?? 0))
    : undefined;
  const resizeHeight = Number.isFinite(options.resizeHeight)
    ? Math.max(1, Math.round(options.resizeHeight ?? 0))
    : undefined;

  if (!resizeWidth && !resizeHeight) {
    return undefined;
  }

  return {
    ...(resizeWidth ? { resizeWidth } : {}),
    ...(resizeHeight ? { resizeHeight } : {}),
    resizeQuality: 'high',
  };
}

export async function loadImageResource(
  url: string,
  strategy: ImageLoadStrategy = 'decode',
  options: ImageResourceLoadOptions = {},
): Promise<LoadedImageResource> {
  const protectedResource = isProtectedResourceUrl(url);

  if (strategy === 'display-url') {
    const protectedHandle = await acquireProtectedResourceUrl(url, {
      persistentEnabled: options.preferPersistentCache,
      persistentVersion: options.persistentVersion,
    });
    return {
      src: protectedHandle.url,
      width: 0,
      height: 0,
      decoded: 'display-url',
      estimatedBytes: 0,
      handle: {
        close: (): void => {
          protectedHandle.release();
        },
      },
    };
  }

  const protectedDisplayHandle = protectedResource
    ? await acquireProtectedResourceUrl(url, {
      persistentEnabled: options.preferPersistentCache,
      persistentVersion: options.persistentVersion,
    })
    : undefined;
  const blobHandle = protectedResource
    ? {
      blob: protectedDisplayHandle?.blob ?? new Blob(),
      release: () => protectedDisplayHandle?.release(),
    }
    : {
      blob: await (async (): Promise<Blob> => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch image resource: ${url}`);
        }
        return response.blob();
      })(),
      release: (): void => undefined,
    };

  if (typeof createImageBitmap === 'function') {
    try {
      const resizeOptions = resolveBitmapResizeOptions(options);
      const bitmap = resizeOptions
        ? await createImageBitmap(blobHandle.blob, resizeOptions)
        : await createImageBitmap(blobHandle.blob);

      return {
        src: protectedDisplayHandle?.url ?? url,
        width: bitmap.width,
        height: bitmap.height,
        decoded: 'bitmap',
        estimatedBytes: estimateBytes(bitmap.width, bitmap.height),
        handle: {
          close: (): void => {
            bitmap.close();
            blobHandle.release();
          },
        },
      };
    } catch {
      // Fall through to HTMLImageElement decoding for unsupported environments and bitmap failures.
    }
  }

  const image = new Image();
  image.decoding = 'async';
  const imageSrc = protectedDisplayHandle?.url ?? url;

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = (): void => resolve();
      image.onerror = (): void => reject(new Error(`Failed to load image resource: ${url}`));
      image.src = imageSrc;
    });

    return {
      src: imageSrc,
      width: image.naturalWidth,
      height: image.naturalHeight,
      decoded: 'image',
      estimatedBytes: estimateBytes(image.naturalWidth, image.naturalHeight),
      handle: {
        close: (): void => {
          image.src = '';
          blobHandle.release();
        },
      },
    };
  } catch (error) {
    image.src = '';
    blobHandle.release();
    throw error;
  }
}
