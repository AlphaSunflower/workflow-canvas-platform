export interface WhiteModelRenderExecutorInput {
  userId: string;
  runId: string;
  taskId: string;
  taskNo: string;
  whiteModelFileId: string;
  styleReferenceFileId: string;
  model: "gemini-3-pro-image-preview" | "gpt-image-2" | "gpt-image-2-vip";
  imageSize?: "1K" | "2K" | "4K";
  aspectRatio?: "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5";
}

export interface WhiteModelRenderExecutorResult {
  resultFileId: string;
  resultStorageKey: string;
  lineartFileId: string;
  depthFileId: string;
  usedCachedLineart: boolean;
  usedCachedDepth: boolean;
}
