import type {
  LaozhangOpenAIImagesQuality,
} from "@newworkflow/backend-shared";
import type {
  LaozhangOpenAIImageParsedBase64Result,
  LaozhangOpenAIImageParsedUrlResult,
  LaozhangSuccessResult,
} from "./laozhang.types.ts";

export type LaozhangOpenAIImagesModel = "gpt-image-2";

export interface LaozhangOpenAIImagesGenerateInput {
  prompt: string;
  model: LaozhangOpenAIImagesModel;
  size: string;
  quality: LaozhangOpenAIImagesQuality;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export interface LaozhangOpenAIImagesEditInput {
  prompt: string;
  model: LaozhangOpenAIImagesModel;
  size: string;
  quality?: LaozhangOpenAIImagesQuality;
  image: Blob;
  imageFileName: string;
  mask?: Blob;
  maskFileName?: string;
  timeoutMs?: number;
  snapshotLabel?: string;
}

export type LaozhangOpenAIImagesParsedResult =
  | LaozhangOpenAIImageParsedBase64Result
  | LaozhangOpenAIImageParsedUrlResult;

export type LaozhangOpenAIImagesSuccessResult = LaozhangSuccessResult;
