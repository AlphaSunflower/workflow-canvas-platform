import {
  AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE,
  buildStoryboardArrangeUserPrompt,
  buildStoryboardStorySystemPrompt,
  buildStoryboardStoryUserPrompt,
} from "./storyboard-arrange.constants.ts";
import type { StoryboardCreationType } from "./storyboard-arrange.constants.ts";
import type {
  LaozhangVisionChatMessage,
  LaozhangVisionMessageContentPart,
} from "./providers/laozhang-vision.client.ts";

export interface StoryboardArrangeMessageShot {
  shotId: string;
  imageDataUrl: string;
}

function buildShotInfoText(shotId: string): string {
  return AI_STORYBOARD_ARRANGE_IMAGE_INFO_TEXT_TEMPLATE.replace("{{shotId}}", shotId);
}

export function buildStoryboardArrangeMessages(input: {
  shots: StoryboardArrangeMessageShot[];
}): LaozhangVisionChatMessage[] {
  const content: LaozhangVisionMessageContentPart[] = [
    {
      type: "text",
      text: buildStoryboardArrangeUserPrompt(input.shots.length),
    },
  ];

  input.shots.forEach((shot) => {
    content.push({
      type: "text",
      text: buildShotInfoText(shot.shotId),
    });
    content.push({
      type: "image_url",
      image_url: {
        url: shot.imageDataUrl,
      },
    });
  });

  return [
    {
      role: "user",
      content,
    },
  ];
}

export function buildStoryboardStoryMessages(input: {
  storyText: string;
  creationType: StoryboardCreationType;
}): LaozhangVisionChatMessage[] {
  return [
    {
      role: "system",
      content: buildStoryboardStorySystemPrompt(input.creationType),
    },
    {
      role: "user",
      content: buildStoryboardStoryUserPrompt(input.storyText, input.creationType),
    },
  ];
}
