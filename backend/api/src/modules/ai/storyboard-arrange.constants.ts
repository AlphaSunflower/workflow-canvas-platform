export const AI_STORYBOARD_ARRANGE_NODE_TYPE = "aiStoryboard" as const;
export const AI_STORYBOARD_ARRANGE_PROMPT_VERSION = "ai-storyboard-arrange-v1" as const;
export const AI_STORYBOARD_ARRANGE_MESSAGE_ROLE = "user" as const;
export const AI_STORYBOARD_ARRANGE_USE_SYSTEM_PROMPT = false as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_MAX_DIMENSION = 512 as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_FORMAT = "jpeg" as const;
export const AI_STORYBOARD_ARRANGE_IMAGE_QUALITY = 0.6 as const;

export const AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE =
  "图片信息 [shotId: {{shotId}}]:" as const;

export function buildStoryboardArrangeUserPrompt(shotCount: number): string {
  return `你是一位顶级的建筑与空间漫游视频导演。我提供了${shotCount}张尚未排序的图片分镜。
请仔细观察这些图片的画面内容、空间关系、光影流转，然后：
1. 为它们找出一条符合真实漫游逻辑的“最佳空间排布或时间推移顺序”（比如从全局到局部，从入口到深处）。
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
