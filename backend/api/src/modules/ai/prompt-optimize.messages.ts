import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_REFERENCE_SYSTEM_PROMPT,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT,
} from "./prompt-optimize.constants.ts";

export interface PromptOptimizeMessageImage {
  dataUrl: string;
}

export interface PromptOptimizeChatMessage {
  role: "system" | "user";
  content:
    | string
    | Array<
      | {
        type: "text";
        text: string;
      }
      | {
        type: "image_url";
        image_url: {
          url: string;
        };
      }
    >;
}

export function buildPromptOptimizeSystemPrompt(referenceImageCount: number): string {
  return referenceImageCount > 0
    ? `${AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT}\n\n${AI_IMAGE_GEN_PROMPT_OPTIMIZE_REFERENCE_SYSTEM_PROMPT}`
    : AI_IMAGE_GEN_PROMPT_OPTIMIZE_SYSTEM_PROMPT;
}

export function buildPromptOptimizeUserText(prompt: string): string {
  return [
    "请优化下面的用户输入，使其成为可直接用于 AI 生成的中文提示词。",
    "",
    "用户输入：",
    prompt.trim(),
    "",
    "请根据输入内容自动判断需求类型，并按对应场景优化：",
    "1. 如果是简短想法，请补全主体、场景、动作、风格、材质、光线、色彩、构图和画质要求。",
    "2. 如果是修改或局部重绘，请明确保留内容与修改内容，避免无关区域被重写。",
    "3. 如果是商品、角色、海报、室内、建筑、UI、图标、分镜或视频镜头，请补充该类型最关键的专业描述。",
    "4. 如果提供了参考图片，请结合图片内容；如果没有参考图片，请仅基于文本进行扩写，不要假装看到了图片。",
    "5. 保持用户原意，不要擅自改变题材、主体身份或商业用途。",
    "只返回最终优化后的中文提示词纯文本。",
  ].join("\n");
}

export function buildPromptOptimizeMessages(input: {
  prompt: string;
  images: PromptOptimizeMessageImage[];
}): PromptOptimizeChatMessage[] {
  return [
    {
      role: "system",
      content: buildPromptOptimizeSystemPrompt(input.images.length),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: buildPromptOptimizeUserText(input.prompt),
        },
        ...input.images.map((image) => ({
          type: "image_url" as const,
          image_url: {
            url: image.dataUrl,
          },
        })),
      ],
    },
  ];
}

export function cleanPromptOptimizeResponseText(value: string): string {
  return value
    .replace(/```text/gi, "")
    .replace(/```markdown/gi, "")
    .replace(/```/g, "")
    .trim();
}
