import assert from "node:assert/strict";

import {
  AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY,
  AI_IMAGE_GEN_DEFAULT_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  AI_IMAGE_GEN_OFFICIAL_QUALITIES,
  AI_IMAGE_GEN_SUPPORTED_MODELS,
  isAIImageGenOfficialModel,
  isAIImageGenOfficialQuality,
  isAIImageGenParameterlessModel,
  isAIImageGenSupportedModel,
  resolveAIImageGenOutputSize,
} from "./aiImageGen.ts";
import {
  LAOZHANG_OPENAI_IMAGES_PROVIDER_MODEL_GPT_IMAGE_2,
} from "./laozhangOpenAIImages.ts";

assert.equal(
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  "gpt-image-2-official",
);
assert.equal(
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_MODEL_GPT_IMAGE_2,
);
assert.equal(AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY, "auto");
assert.equal(AI_IMAGE_GEN_DEFAULT_MODEL, AI_IMAGE_GEN_GPT_IMAGE_2_MODEL);
assert.deepEqual(AI_IMAGE_GEN_OFFICIAL_QUALITIES, [
  "auto",
  "low",
  "medium",
  "high",
]);
assert.equal(AI_IMAGE_GEN_SUPPORTED_MODELS.includes("gpt-image-2-vip"), true);
assert.equal(AI_IMAGE_GEN_SUPPORTED_MODELS.includes("gpt-image-2"), true);
assert.equal(AI_IMAGE_GEN_SUPPORTED_MODELS.includes("gpt-image-2-official"), true);

assert.equal(isAIImageGenSupportedModel("gpt-image-2"), true);
assert.equal(isAIImageGenParameterlessModel("gpt-image-2"), true);
assert.equal(isAIImageGenParameterlessModel("gpt-image-2-vip"), false);
assert.equal(isAIImageGenSupportedModel("gpt-image-2-official"), true);
assert.equal(isAIImageGenOfficialModel("gpt-image-2-official"), true);
assert.equal(isAIImageGenOfficialModel("gpt-image-2-vip"), false);
assert.equal(isAIImageGenOfficialQuality("auto"), true);
assert.equal(isAIImageGenOfficialQuality("low"), true);
assert.equal(isAIImageGenOfficialQuality("medium"), true);
assert.equal(isAIImageGenOfficialQuality("high"), true);
assert.equal(isAIImageGenOfficialQuality("ultra"), false);

assert.equal(
  resolveAIImageGenOutputSize("gpt-image-2", "2K", "16:9"),
  null,
);
assert.equal(
  resolveAIImageGenOutputSize("gpt-image-2-official", "2K", "auto"),
  "auto",
);
assert.equal(
  resolveAIImageGenOutputSize("gpt-image-2-official", "2K", "16:9"),
  "2048x1152",
);
assert.equal(
  resolveAIImageGenOutputSize("gpt-image-2-vip", "2K", "16:9"),
  "2048x1152",
);
assert.equal(
  resolveAIImageGenOutputSize("gpt-image-2-vip", "2K", "auto"),
  null,
);
assert.equal(
  resolveAIImageGenOutputSize("gemini-3-pro-image-preview", "2K", "auto"),
  null,
);
