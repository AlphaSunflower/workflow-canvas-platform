import sharp from "sharp";

export interface ImageDerivativeVariant {
  kind: "thumbnail" | "preview";
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  extension: string;
}

export interface ImageDerivativeResult {
  thumbnail: ImageDerivativeVariant;
  preview: ImageDerivativeVariant;
}

interface ResizeSpec {
  kind: "thumbnail" | "preview";
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value));
}

function normalizeFormatToMimeType(format: string | null | undefined): string {
  if (!format) {
    return "image/jpeg";
  }

  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "image/jpeg";
  }
}

function normalizeMimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}

export class ImageDerivativeService {
  private readonly thumbnailSpec: ResizeSpec = {
    kind: "thumbnail",
    maxWidth: 320,
    maxHeight: 320,
    quality: 80,
  };

  private readonly previewSpec: ResizeSpec = {
    kind: "preview",
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 85,
  };

  async generate(
    buffer: Buffer | Uint8Array,
  ): Promise<ImageDerivativeResult | null> {
    try {
      const source = sharp(buffer, { failOn: "none" }).rotate();
      const metadata = await source.metadata();

      if (
        typeof metadata.width !== "number" ||
        typeof metadata.height !== "number" ||
        metadata.width <= 0 ||
        metadata.height <= 0
      ) {
        return null;
      }

      const outputMimeType = normalizeFormatToMimeType(metadata.format);

      const [thumbnail, preview] = await Promise.all([
        this.renderVariant(buffer, metadata.width, metadata.height, outputMimeType, this.thumbnailSpec),
        this.renderVariant(buffer, metadata.width, metadata.height, outputMimeType, this.previewSpec),
      ]);

      return {
        thumbnail,
        preview,
      };
    } catch {
      return null;
    }
  }

  private async renderVariant(
    buffer: Buffer | Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    outputMimeType: string,
    spec: ResizeSpec,
  ): Promise<ImageDerivativeVariant> {
    const pipeline = sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: spec.maxWidth,
        height: spec.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });

    switch (outputMimeType) {
      case "image/png":
        pipeline.png({
          compressionLevel: 9,
          palette: true,
        });
        break;
      case "image/webp":
        pipeline.webp({
          quality: spec.quality,
        });
        break;
      case "image/avif":
        pipeline.avif({
          quality: spec.quality,
        });
        break;
      default:
        pipeline.jpeg({
          quality: spec.quality,
          mozjpeg: true,
        });
        outputMimeType = "image/jpeg";
        break;
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    const mimeType = normalizeFormatToMimeType(info.format ?? outputMimeType);

    return {
      kind: spec.kind,
      buffer: data,
      mimeType,
      width: clampDimension(info.width ?? sourceWidth),
      height: clampDimension(info.height ?? sourceHeight),
      extension: normalizeMimeTypeToExtension(mimeType),
    };
  }
}
