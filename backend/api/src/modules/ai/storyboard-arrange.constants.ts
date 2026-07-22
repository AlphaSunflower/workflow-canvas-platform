export const AI_STORYBOARD_ARRANGE_NODE_TYPE = "aiStoryboard" as const;
export const AI_STORYBOARD_ARRANGE_PROMPT_VERSION = "ai-storyboard-arrange-v1" as const;
export const AI_STORYBOARD_ARRANGE_MESSAGE_ROLE = "user" as const;
export const AI_STORYBOARD_ARRANGE_USE_SYSTEM_PROMPT = false as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_MAX_DIMENSION = 512 as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_FORMAT = "jpeg" as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_QUALITY = 0.6 as const;

export const AI_STORYBOARD_STORY_PROMPT_VERSION = "ai-storyboard-story-v1" as const;
export const AI_STORYBOARD_STORY_MAX_TEXT_LENGTH = 5000 as const;
export const AI_STORYBOARD_STORY_MAX_SHOTS = 20 as const;

export const AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE =
  "图片信息 [shotId: {{shotId}}]:" as const;

export function buildStoryboardArrangeUserPrompt(shotCount: number): string {
  return `你是一位顶级的建筑与空间漫游视频导演。我提供了${shotCount}张尚未排序的图片分镜。
请仔细观察这些图片的画面内容、空间关系、光影流转，然后：
1. 为它们找出一条符合真实漫游逻辑的"最佳空间排布或时间推移顺序"（比如从全局到局部，从入口到深处）。
2. 基于你排出的顺序，为每一幕撰写【纯中文】的极致视频生成提示词。
提示词的结构必须包含：画面核心主体、具体的自然动态（例如：微风吹动轻质纱帘、水波粼粼）、以及你作为导演给出的专业摄像机运动指令（例如：镜头缓慢 Dolly in 并向右微 Pan、缓慢推进特写）。

严禁输出多余寒暄，必须严格以JSON数组格式返回，格式完全如下：
[
  {
    "shotId": "对应的shotId",
    "order": 1,
    "prompt": "生成的中文视频提示词"
  }
]`;
}

export type StoryboardCreationType = "architecture" | "product" | "narrative" | "custom";

export const VALID_CREATION_TYPES: readonly StoryboardCreationType[] = [
  "architecture",
  "product",
  "narrative",
  "custom",
] as const;

const CREATION_TYPE_CONTEXT: Record<StoryboardCreationType, string> = {
  architecture: "建筑漫游 — 大量 Dolly in/out、Pan、Crane 运镜，强调空间层次和光影变化",
  product: "产品展示 — 特写镜头、环绕拍摄、细节聚焦、质感展示",
  narrative: "故事叙述 — 中景为主、情感特写、对话框构图、节奏变化",
  custom: "根据剧情自动判断最佳镜头风格和运镜方式",
};

export function buildStoryboardStorySystemPrompt(creationType: StoryboardCreationType): string {
  const context = CREATION_TYPE_CONTEXT[creationType];
  return `你是一位顶级的视频分镜导演和 AI 视频生成专家。你的任务是根据用户提供的剧情，创作完整的视频分镜表。

创作类型：${context}

要求：
1. 根据剧情节奏，合理拆分为 6-12 个分镜镜头
2. 每个镜头的提示词必须包含：
   - 【画面主体】：清晰描述画面核心内容
   - 【自然动态】：具体的动态描述（如：微风吹动、水流潺潺、光影流转）
   - 【镜头类型】：全景/远景/中景/近景/特写
   - 【摄像机运动】：专业的运镜指令（如：缓慢 Dolly in、向右 Pan、Crane up 俯拍、跟踪拍摄）
   - 【摄像机状态】：静态/动态/跟踪
3. 确保镜头之间的连贯性和叙事逻辑
4. 使用纯中文描述`;
}

export function buildStoryboardStoryUserPrompt(
  storyText: string,
  _creationType: StoryboardCreationType,
): string {
  return `剧情描述：
${storyText}

请根据以上剧情，创作完整的视频分镜表。严格以 JSON 数组格式返回：
[
  {
    "shotId": "story-shot-1",
    "order": 1,
    "prompt": "完整的视频生成提示词（包含画面主体、动态、镜头类型、摄像机运动、摄像机状态）",
    "shotDescription": "简短的分镜描述（10字以内，用于 UI 展示）"
  }
]`;
}
