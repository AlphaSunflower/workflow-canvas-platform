import sharp from "sharp";

export interface ImageMetadataResult {
  width: number;
  height: number;
  format: string | null;
}

export class ImageMetadataService {
  async extract(buffer: Buffer | Uint8Array): Promise<ImageMetadataResult | null> {
    try {
      const metadata = await sharp(buffer).metadata();

      if (
        typeof metadata.width !== "number" ||
        typeof metadata.height !== "number" ||
        metadata.width <= 0 ||
        metadata.height <= 0
      ) {
        return null;
      }

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format ?? null,
      };
    } catch {
      return null;
    }
  }
}
