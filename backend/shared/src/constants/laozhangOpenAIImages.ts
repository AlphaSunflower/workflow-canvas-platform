export const LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE = "sora2official" as const;
export const LAOZHANG_OPENAI_IMAGES_PROVIDER_MODEL_GPT_IMAGE_2 = "gpt-image-2" as const;

export const LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_OFFICIAL_MODEL = "gpt-image-2-official" as const;
export const LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_OFFICIAL_LABEL = "GPT Image 2 Official" as const;
export const LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_LEGACY_LABEL = "GPT Image 2 VIP" as const;

export const LAOZHANG_OPENAI_IMAGES_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
] as const;

export type LaozhangOpenAIImagesQuality =
  (typeof LAOZHANG_OPENAI_IMAGES_QUALITIES)[number];

export function isLaozhangOpenAIImagesQuality(
  value: unknown,
): value is LaozhangOpenAIImagesQuality {
  return typeof value === "string"
    && (LAOZHANG_OPENAI_IMAGES_QUALITIES as readonly string[]).includes(value);
}
