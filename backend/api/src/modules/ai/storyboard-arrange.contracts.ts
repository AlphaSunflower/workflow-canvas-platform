import {
  AI_STORYBOARD_ARRANGE_NODE_TYPE,
  AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
} from "./storyboard-arrange.constants.ts";

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

export interface StoryboardArrangeShotResult {
  shotId: string;
  order: number;
  prompt: string;
}

export interface StoryboardArrangeResult {
  shots: StoryboardArrangeShotResult[];
  model: string;
  referenceCount: number;
  promptVersion: typeof AI_STORYBOARD_ARRANGE_PROMPT_VERSION;
}
