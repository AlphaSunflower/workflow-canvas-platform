import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';

import type { Viewport } from '@/types';

import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import {
  resolveCanvasImagePixiCoverTextureDescriptor,
  type CanvasImagePixiCoverTextureDescriptor,
} from './canvas-image-pixi-cover';

export interface CanvasImagePixiRendererOptions {
  canvasSize: {
    width: number;
    height: number;
  };
  devicePixelRatio?: number;
  onImagePainted?: (item: Pick<CanvasImageRasterItem, 'nodeId' | 'src'> & { src: string }) => void;
}

export interface CanvasImagePixiRenderOptions extends CanvasImagePixiRendererOptions {
  items: readonly CanvasImageRasterItem[];
  viewport: Viewport;
  resolveImage: (src: string) => HTMLImageElement | undefined;
  textureUploadBudget?: number;
  now?: () => number;
}

export interface CanvasImagePixiRenderResult {
  itemCount: number;
  drawnItemCount: number;
  cacheMissItemCount: number;
  lodSkippedItemCount: number;
  deferredItemCount: number;
  textureUploadBudget: number;
  textureUploadCount: number;
  textureEvictedCount: number;
  textureRetainedCount: number;
  textureByteEstimate: number;
  activeSpriteCount: number;
  spritePoolSize: number;
  createdSpriteCount: number;
  reusedSpriteCount: number;
  releasedSpriteCount: number;
}

interface PixiSpriteEntry {
  sprite: Sprite;
  clusterBackground?: Graphics;
  src: string;
  texture: Texture;
  cropKey: string;
  ownsTexture: boolean;
  pooled: boolean;
}

interface PixiTextureEntry {
  src: string;
  texture: Texture;
  sourceWidth: number;
  sourceHeight: number;
  estimatedBytes: number;
  createdAt: number;
  lastUsedAt: number;
  lastVisibleAt: number;
}

interface PixiRenderCounters {
  createdSpriteCount: number;
  reusedSpriteCount: number;
  releasedSpriteCount: number;
  textureUploadCount: number;
  textureEvictedCount: number;
}

interface PixiTextureResolveResult {
  entry: PixiTextureEntry;
  uploaded: boolean;
}

const PIXI_LOD_MIN_SCREEN_AREA = 16;
const PIXI_TEXTURE_RETENTION_MS = 6_000;
const PIXI_TEXTURE_MAX_COUNT = 512;
const PIXI_TEXTURE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TEXTURE_UPLOAD_BUDGET = 8;

function resolveImageSize(image: HTMLImageElement): {
  width: number;
  height: number;
} {
  return {
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1,
  };
}

function estimateTextureBytes(image: HTMLImageElement): number {
  const size = resolveImageSize(image);
  return Math.max(1, size.width) * Math.max(1, size.height) * 4;
}

function buildCoverTextureDescriptor(
  textureEntry: PixiTextureEntry,
  item: CanvasImageRasterItem,
): CanvasImagePixiCoverTextureDescriptor {
  return resolveCanvasImagePixiCoverTextureDescriptor({
    src: textureEntry.src,
    sourceWidth: textureEntry.sourceWidth,
    sourceHeight: textureEntry.sourceHeight,
    itemWidth: item.width,
    itemHeight: item.height,
  });
}

function buildCoverTexture(
  textureEntry: PixiTextureEntry,
  descriptor: CanvasImagePixiCoverTextureDescriptor,
): Texture {
  return new Texture({
    source: textureEntry.texture.source,
    frame: new Rectangle(
      descriptor.sourceX,
      descriptor.sourceY,
      descriptor.sourceWidth,
      descriptor.sourceHeight,
    ),
  });
}

function createEmptyRenderResult(itemCount: number): CanvasImagePixiRenderResult {
  return {
    itemCount,
    drawnItemCount: 0,
    cacheMissItemCount: 0,
    lodSkippedItemCount: 0,
    deferredItemCount: 0,
    textureUploadBudget: 0,
    textureUploadCount: 0,
    textureEvictedCount: 0,
    textureRetainedCount: 0,
    textureByteEstimate: 0,
    activeSpriteCount: 0,
    spritePoolSize: 0,
    createdSpriteCount: 0,
    reusedSpriteCount: 0,
    releasedSpriteCount: 0,
  };
}

export class CanvasImagePixiRenderer {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;

  private readonly stage = new Container();
  private readonly clusterBackgroundsByNodeId = new Map<string, Graphics>();
  private readonly spritesByNodeId = new Map<string, PixiSpriteEntry>();
  private readonly spritePool: Sprite[] = [];
  private readonly texturesBySrc = new Map<string, PixiTextureEntry>();
  private readonly onImagePainted?: CanvasImagePixiRendererOptions['onImagePainted'];
  private disposed = false;

  private constructor(
    app: Application,
    canvas: HTMLCanvasElement,
    options: CanvasImagePixiRendererOptions,
  ) {
    this.app = app;
    this.canvas = canvas;
    this.onImagePainted = options.onImagePainted;
    this.app.stage.addChild(this.stage);
  }

  static async create(options: CanvasImagePixiRendererOptions): Promise<CanvasImagePixiRenderer> {
    const app = new Application();
    await app.init({
      width: Math.max(1, Math.round(options.canvasSize.width)),
      height: Math.max(1, Math.round(options.canvasSize.height)),
      resolution: Math.max(1, options.devicePixelRatio ?? 1),
      autoDensity: true,
      autoStart: false,
      antialias: false,
      backgroundAlpha: 0,
      preference: 'webgl',
    });

    return new CanvasImagePixiRenderer(
      app,
      app.canvas as HTMLCanvasElement,
      options,
    );
  }

  render({
    items,
    viewport,
    canvasSize,
    devicePixelRatio = 1,
    resolveImage,
    textureUploadBudget = DEFAULT_TEXTURE_UPLOAD_BUDGET,
    now = (): number => performance.now(),
  }: CanvasImagePixiRenderOptions): CanvasImagePixiRenderResult {
    if (this.disposed) {
      return createEmptyRenderResult(items.length);
    }

    this.resize(canvasSize, devicePixelRatio);
    const liveNodeIds = new Set<string>();
    const liveTextureSrcs = new Set<string>();
    const counters: PixiRenderCounters = {
      createdSpriteCount: 0,
      reusedSpriteCount: 0,
      releasedSpriteCount: 0,
      textureUploadCount: 0,
      textureEvictedCount: 0,
    };
    const startedAt = now();
    const resolvedTextureUploadBudget = Math.max(0, Math.floor(textureUploadBudget));
    let remainingTextureUploads = resolvedTextureUploadBudget;
    let drawnItemCount = 0;
    let cacheMissItemCount = 0;
    let lodSkippedItemCount = 0;
    let deferredItemCount = 0;

    items.forEach((item) => {
      const isCluster = item.kind === 'cluster' || item.status === 'cluster';
      if (!isCluster && (item.status !== 'ready' || !item.src)) {
        return;
      }

      const zoom = viewport.zoom || 1;
      const screenWidth = item.width * zoom;
      const screenHeight = item.height * zoom;
      const screenX = item.x * zoom + viewport.x;
      const screenY = item.y * zoom + viewport.y;

      if (
        screenWidth <= 0 ||
        screenHeight <= 0 ||
        screenX > canvasSize.width ||
        screenY > canvasSize.height ||
        screenX + screenWidth < 0 ||
        screenY + screenHeight < 0
      ) {
        return;
      }

      if (screenWidth * screenHeight < PIXI_LOD_MIN_SCREEN_AREA) {
        lodSkippedItemCount += 1;
        return;
      }

      const textureResult = item.src
        ? this.resolveTextureEntry({
          src: item.src,
          image: resolveImage(item.src),
          now: startedAt,
          remainingTextureUploads,
          counters,
        })
        : null;
      if (!textureResult && !isCluster) {
        if (item.src && this.texturesBySrc.has(item.src)) {
          deferredItemCount += 1;
        } else {
          cacheMissItemCount += 1;
        }
        return;
      }
      if (textureResult?.uploaded) {
        remainingTextureUploads = Math.max(0, remainingTextureUploads - 1);
      }
      const textureEntry = textureResult?.entry;

      if (textureEntry) {
        textureEntry.lastUsedAt = startedAt;
        textureEntry.lastVisibleAt = startedAt;
        liveTextureSrcs.add(textureEntry.src);
      }
      const entry = this.resolveSprite(item, textureEntry?.texture ?? Texture.EMPTY, counters);
      const coverTexture = this.resolveItemTexture(entry, textureEntry, item, isCluster);

      entry.sprite.texture = coverTexture;
      entry.src = item.src ?? '';
      entry.sprite.visible = true;
      entry.sprite.x = item.x + item.width / 2;
      entry.sprite.y = item.y + item.height / 2;
      entry.sprite.width = item.width;
      entry.sprite.height = item.height;
      entry.sprite.rotation = (item.rotation * Math.PI) / 180;
      this.syncClusterBackground(item, entry, isCluster, viewport.zoom || 1);
      liveNodeIds.add(item.nodeId);
      drawnItemCount += 1;
      if (!isCluster && item.src) {
        this.onImagePainted?.({
          nodeId: item.nodeId,
          src: item.src,
        });
      }
    });

    this.releaseInactiveSprites(liveNodeIds, counters);
    counters.textureEvictedCount = this.evictTextures(liveTextureSrcs, startedAt);
    this.stage.position.set(viewport.x, viewport.y);
    this.stage.scale.set(viewport.zoom || 1);
    this.app.render();

    return {
      itemCount: items.length,
      drawnItemCount,
      cacheMissItemCount,
      lodSkippedItemCount,
      deferredItemCount,
      textureUploadBudget: resolvedTextureUploadBudget,
      textureUploadCount: counters.textureUploadCount,
      textureEvictedCount: counters.textureEvictedCount,
      textureRetainedCount: this.texturesBySrc.size,
      textureByteEstimate: this.getTextureByteEstimate(),
      activeSpriteCount: this.spritesByNodeId.size,
      spritePoolSize: this.spritePool.length,
      createdSpriteCount: counters.createdSpriteCount,
      reusedSpriteCount: counters.reusedSpriteCount,
      releasedSpriteCount: counters.releasedSpriteCount,
    };
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.spritesByNodeId.forEach((entry) => {
      entry.sprite.texture = Texture.EMPTY;
      this.clearOwnedTexture(entry);
    });
    this.spritesByNodeId.clear();
    this.spritePool.length = 0;
    this.clusterBackgroundsByNodeId.clear();
    this.texturesBySrc.forEach((entry) => {
      entry.texture.destroy(true);
    });
    this.texturesBySrc.clear();
    this.stage.destroy({ children: true });
    this.canvas.remove();
    this.app.destroy(true);
  }

  private resize(
    canvasSize: CanvasImagePixiRendererOptions['canvasSize'],
    devicePixelRatio: number,
  ): void {
    this.app.renderer.resize(
      Math.max(1, Math.round(canvasSize.width)),
      Math.max(1, Math.round(canvasSize.height)),
      Math.max(1, devicePixelRatio),
    );
  }

  private resolveTextureEntry({
    src,
    image,
    now,
    remainingTextureUploads,
    counters,
  }: {
    src: string;
    image?: HTMLImageElement;
    now: number;
    remainingTextureUploads: number;
    counters: PixiRenderCounters;
  }): PixiTextureResolveResult | null {
    const existing = this.texturesBySrc.get(src);
    if (existing) {
      return {
        entry: existing,
        uploaded: false,
      };
    }

    if (!image || remainingTextureUploads <= 0) {
      return null;
    }

    const sourceSize = resolveImageSize(image);
    const texture = Texture.from(image, true);
    const entry: PixiTextureEntry = {
      src,
      texture,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      estimatedBytes: estimateTextureBytes(image),
      createdAt: now,
      lastUsedAt: now,
      lastVisibleAt: now,
    };
    this.texturesBySrc.set(src, entry);
    counters.textureUploadCount += 1;
    return {
      entry,
      uploaded: true,
    };
  }

  private resolveSprite(
    item: CanvasImageRasterItem,
    texture: Texture,
    counters: PixiRenderCounters,
  ): PixiSpriteEntry {
    const existing = this.spritesByNodeId.get(item.nodeId);
    if (existing) {
      return existing;
    }

    const sprite = this.spritePool.pop() ?? new Sprite(texture);
    const reusedFromPool = Boolean((sprite as Sprite & { __canvasImagePooled?: boolean }).__canvasImagePooled);
    if (!sprite.parent) {
      this.stage.addChild(sprite);
    }

    if (reusedFromPool) {
      counters.reusedSpriteCount += 1;
    } else {
      counters.createdSpriteCount += 1;
    }
    (sprite as Sprite & { __canvasImagePooled?: boolean }).__canvasImagePooled = false;
    sprite.anchor.set(0.5);
    sprite.eventMode = 'none';
    sprite.texture = texture;
    sprite.visible = true;
    const entry: PixiSpriteEntry = {
      sprite,
      src: item.src ?? '',
      texture,
      cropKey: '',
      ownsTexture: false,
      pooled: false,
    };
    this.spritesByNodeId.set(item.nodeId, entry);
    return entry;
  }

  private resolveItemTexture(
    entry: PixiSpriteEntry,
    textureEntry: PixiTextureEntry | undefined,
    item: CanvasImageRasterItem,
    isCluster: boolean,
  ): Texture {
    if (isCluster) {
      this.clearOwnedTexture(entry);
      entry.texture = textureEntry?.texture ?? Texture.EMPTY;
      entry.cropKey = '';
      entry.ownsTexture = false;
      return entry.texture;
    }

    if (!textureEntry) {
      this.clearOwnedTexture(entry);
      return Texture.EMPTY;
    }

    return this.resolveCoverTexture(entry, textureEntry, item);
  }

  private resolveCoverTexture(
    entry: PixiSpriteEntry,
    textureEntry: PixiTextureEntry,
    item: CanvasImageRasterItem,
  ): Texture {
    const nextCoverTexture = buildCoverTextureDescriptor(textureEntry, item);
    if (entry.cropKey === nextCoverTexture.cropKey) {
      return entry.texture;
    }

    this.clearOwnedTexture(entry);
    entry.cropKey = nextCoverTexture.cropKey;
    entry.texture = buildCoverTexture(textureEntry, nextCoverTexture);
    entry.ownsTexture = true;
    return entry.texture;
  }

  private clearOwnedTexture(entry: PixiSpriteEntry): void {
    if (entry.ownsTexture && entry.texture !== Texture.EMPTY) {
      entry.texture.destroy(false);
    }
    entry.texture = Texture.EMPTY;
    entry.cropKey = '';
    entry.ownsTexture = false;
  }

  private releaseInactiveSprites(
    liveNodeIds: ReadonlySet<string>,
    counters: PixiRenderCounters,
  ): void {
    this.spritesByNodeId.forEach((entry, nodeId) => {
      if (liveNodeIds.has(nodeId)) {
        return;
      }

      entry.sprite.visible = false;
      entry.sprite.texture = Texture.EMPTY;
      this.clearOwnedTexture(entry);
      entry.clusterBackground?.destroy();
      this.clusterBackgroundsByNodeId.delete(nodeId);
      entry.src = '';
      entry.pooled = true;
      (entry.sprite as Sprite & { __canvasImagePooled?: boolean }).__canvasImagePooled = true;
      this.spritesByNodeId.delete(nodeId);
      this.spritePool.push(entry.sprite);
      counters.releasedSpriteCount += 1;
    });
  }

  private syncClusterBackground(
    item: CanvasImageRasterItem,
    entry: PixiSpriteEntry,
    isCluster: boolean,
    zoom: number,
  ): void {
    if (!isCluster) {
      entry.clusterBackground?.destroy();
      this.clusterBackgroundsByNodeId.delete(item.nodeId);
      entry.clusterBackground = undefined;
      entry.sprite.alpha = 1;
      return;
    }

    let background = entry.clusterBackground ?? this.clusterBackgroundsByNodeId.get(item.nodeId);
    if (!background) {
      background = new Graphics();
      this.stage.addChildAt(background, 0);
      this.clusterBackgroundsByNodeId.set(item.nodeId, background);
      entry.clusterBackground = background;
    }

    background.clear();
    background.roundRect(item.x, item.y, item.width, item.height, Math.max(8, Math.min(item.width, item.height) * 0.16));
    background.fill({ color: 0x0f172a, alpha: 0.82 });
    background.stroke({ width: Math.max(1, 1 / Math.max(zoom, 0.0001)), color: 0x94a3b8, alpha: 0.72 });
    background.visible = true;
    entry.sprite.alpha = item.src ? 0.72 : 0;
  }

  private evictTextures(liveTextureSrcs: ReadonlySet<string>, now: number): number {
    let evictedCount = 0;
    let totalBytes = this.getTextureByteEstimate();
    const entries = Array.from(this.texturesBySrc.values())
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

    entries.forEach((entry) => {
      if (liveTextureSrcs.has(entry.src)) {
        return;
      }

      const expired = now - entry.lastVisibleAt >= PIXI_TEXTURE_RETENTION_MS;
      const overCountBudget = this.texturesBySrc.size > PIXI_TEXTURE_MAX_COUNT;
      const overByteBudget = totalBytes > PIXI_TEXTURE_MAX_BYTES;
      if (!expired && !overCountBudget && !overByteBudget) {
        return;
      }

      entry.texture.destroy(true);
      this.texturesBySrc.delete(entry.src);
      totalBytes = Math.max(0, totalBytes - entry.estimatedBytes);
      evictedCount += 1;
    });

    return evictedCount;
  }

  private getTextureByteEstimate(): number {
    let totalBytes = 0;
    this.texturesBySrc.forEach((entry) => {
      totalBytes += entry.estimatedBytes;
    });
    return totalBytes;
  }
}
