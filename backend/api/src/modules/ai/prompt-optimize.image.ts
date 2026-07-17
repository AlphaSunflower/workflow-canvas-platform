import sharp from "sharp";

export interface PromptOptimizeImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface PromptOptimizePreparedImage {
  mimeType: "image/jpeg";
  dataBase64: string;
  dataUrl: string;
  width: number | null;
  height: number | null;
}

export interface PrepareImageOptions {
  maxDimension: number;
  jpegQuality: number;
}

function normalizePositiveInteger(value: number | undefined): number | null {
  if (!Number.isFinite(value) || typeof value !== "number" || value < 1) {
    return null;
  }

  return Math.round(value);
}

function resolveMaxDimension(imageCount: number): number {
  return imageCount <= 1 ? 1024 : 768;
}

export async function preparePromptOptimizeImage(
  input: PromptOptimizeImageInput,
  options?: { maxDimension?: number; jpegQuality?: number },
): Promise<PromptOptimizePreparedImage> {
  const jpegQuality = typeof options?.jpegQuality === "number" ? options.jpegQuality : 80;
  const transformer = sharp(input.buffer, { failOn: "none" }).rotate();
  const metadata = await transformer.metadata();
  const maxDimension = options?.maxDimension ?? resolveMaxDimension(1);

  const output = await transformer
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: jpegQuality,
      mozjpeg: true,
    })
    .toBuffer();

  const outputMetadata = await sharp(output).metadata();
  const dataBase64 = output.toString("base64");

  return {
    mimeType: "image/jpeg",
    dataBase64,
    dataUrl: `data:image/jpeg;base64,${dataBase64}`,
    width: normalizePositiveInteger(outputMetadata.width ?? metadata.width),
    height: normalizePositiveInteger(outputMetadata.height ?? metadata.height),
  };
}

export async function prepareAiMultimodalImage(
  input: PromptOptimizeImageInput,
  options: PrepareImageOptions,
): Promise<PromptOptimizePreparedImage> {
  return preparePromptOptimizeImage(input, options);
}

export async function preparePromptOptimizeImages(
  inputs: PromptOptimizeImageInput[],
): Promise<PromptOptimizePreparedImage[]> {
  const maxDimension = resolveMaxDimension(inputs.length);
  const jpegQuality = inputs.length <= 1 ? 80 : 70;

  return Promise.all(
    inputs.map(async (input) => preparePromptOptimizeImage(input, { maxDimension, jpegQuality })),
  );
}

export async function prepareAiMultimodalImages(
  inputs: PromptOptimizeImageInput[],
  options: PrepareImageOptions,
): Promise<PromptOptimizePreparedImage[]> {
  return Promise.all(
    inputs.map(async (input) => prepareAiMultimodalImage(input, options)),
  );
}
