import type {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  AIImageGenSupportedModel,
  AIImageGenOfficialQuality,
  ExecutionError,
  SharedSupportedAspectRatio,
  SharedSupportedImageSize,
} from "@newworkflow/backend-shared";

export type LaozhangImageSize = SharedSupportedImageSize;

export type LaozhangAspectRatio = Exclude<SharedSupportedAspectRatio, "auto">;

export type LaozhangImageModel = AIImageGenSupportedModel;
export type LaozhangOpenAIParameterlessImageModel = typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
export type LaozhangGPTImage2OfficialModel = typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
export type LaozhangOpenAIImagesProviderModel = typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL;
export type LaozhangGeminiImageModel = Exclude<
  LaozhangImageModel,
  LaozhangOpenAIParameterlessImageModel | "gpt-image-2-vip" | LaozhangGPTImage2OfficialModel
>;
export type LaozhangOpenAIImageEditModel = "gpt-image-2-vip";

export interface LaozhangImageInput {
  dataBase64: string;
  mimeType: string;
}

export interface LaozhangGenerateImageBaseInput {
  prompt: string;
  images: LaozhangImageInput[];
  model?: LaozhangImageModel;
  imageSize?: LaozhangImageSize;
  aspectRatio?: LaozhangAspectRatio;
  size?: string;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface LaozhangGeminiGenerateImageInput
  extends LaozhangGenerateImageBaseInput {
  model?: LaozhangGeminiImageModel;
  size?: never;
}

export interface LaozhangOpenAIParameterlessGenerateImageInput
  extends LaozhangGenerateImageBaseInput {
  model: LaozhangOpenAIParameterlessImageModel;
  imageSize?: never;
  aspectRatio?: never;
  size?: never;
}

export interface LaozhangOpenAIEditImageInput
  extends LaozhangGenerateImageBaseInput {
  model: LaozhangOpenAIImageEditModel;
  imageSize?: never;
  aspectRatio?: never;
  size: string;
}

export interface LaozhangOpenAITextToImageInput
  extends LaozhangGenerateImageBaseInput {
  model: LaozhangOpenAIImageEditModel;
  images: [];
  imageSize?: never;
  aspectRatio?: never;
  size: string;
}

export interface LaozhangOpenAIImagesGenerateImageInput
  extends LaozhangGenerateImageBaseInput {
  model: LaozhangGPTImage2OfficialModel;
  providerModel?: LaozhangOpenAIImagesProviderModel;
  images: [];
  imageSize?: never;
  aspectRatio?: never;
  size: string;
  quality: AIImageGenOfficialQuality;
}

export type LaozhangGenerateImageInput =
  | LaozhangGeminiGenerateImageInput
  | LaozhangOpenAIParameterlessGenerateImageInput
  | LaozhangOpenAIEditImageInput
  | LaozhangOpenAITextToImageInput
  | LaozhangOpenAIImagesGenerateImageInput;

export interface LaozhangRequestPartText {
  text: string;
}

export interface LaozhangRequestPartInlineData {
  inline_data: {
    mime_type: string;
    data: string;
  };
}

export type LaozhangRequestPart =
  | LaozhangRequestPartText
  | LaozhangRequestPartInlineData;

export interface LaozhangRequestPayload {
  contents: Array<{
    parts: LaozhangRequestPart[];
  }>;
  generationConfig: {
    responseModalities: ["IMAGE"];
    imageConfig: {
      imageSize: LaozhangImageSize;
      aspectRatio?: LaozhangAspectRatio;
    };
  };
}

export interface LaozhangSuccessResult {
  imageBase64: string;
  mimeType: string;
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

interface LaozhangOpenAIImageParsedBase {
  rawResponse: unknown;
  responseText: string;
  snapshotPath: string;
}

export interface LaozhangOpenAIImageParsedBase64Result
  extends LaozhangOpenAIImageParsedBase {
  kind: "base64";
  imageBase64: string;
  mimeType: string;
}

export interface LaozhangOpenAIImageParsedUrlResult
  extends LaozhangOpenAIImageParsedBase {
  kind: "url";
  url: string;
}

export type LaozhangOpenAIImageParsedResult =
  | LaozhangOpenAIImageParsedBase64Result
  | LaozhangOpenAIImageParsedUrlResult;

export interface LaozhangErrorResult {
  error: ExecutionError;
  responseText?: string;
  snapshotPath?: string;
}
