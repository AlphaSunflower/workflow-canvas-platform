import {
  AI_STORYBOARD_ARRANGE_NODE_TYPE,
  AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
  AI_STORYBOARD_STORY_PROMPT_VERSION,
} from "./storyboard-arrange.constants.ts";
import type { StoryboardCreationType } from "./storyboard-arrange.constants.ts";

export type { StoryboardCreationType };

export interface StoryboardArrangeShotCommand {
  shotId: string;
  order: number;
  imageFileId: string;
}

export interface StoryboardArrangeCommand {
  workflowId: string;
  nodeId: string;
  nodeType: typeof AI_STORYBOARD_ARRANGE_NODE_TYPE;
  shots: StoryboardArrangeShotCommand[];
}

export interface StoryboardStoryArrangeCommand {
  workflowId: string;
  nodeId: string;
  nodeType: typeof AI_STORYBOARD_ARRANGE_NODE_TYPE;
  storyText: string;
  creationType: StoryboardCreationType;
}

export type StoryboardArrangeMode = "image" | "story";

export interface StoryboardArrangeShotResult {
  shotId: string;
  order: number;
  prompt: string;
  shotDescription?: string;
}

export interface StoryboardArrangeResult {
  shots: StoryboardArrangeShotResult[];
  model: string;
  referenceCount: number;
  promptVersion: typeof AI_STORYBOARD_ARRANGE_PROMPT_VERSION | typeof AI_STORYBOARD_STORY_PROMPT_VERSION;
  mode: StoryboardArrangeMode;
}
